import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
  StopTaskCommand,
  Task,
} from '@aws-sdk/client-ecs';
import { createS3Client } from '../aws/s3-client';
import {
  BackendInterface,
  RunOptions,
  CheaptestConfig,
  RunSummary,
  RunStatus,
  TestResult,
} from '../types';
import { Logger } from '../utils/logger';
import { withRetry, getErrorMessage } from '../utils/retry';

export class ECSBackend implements BackendInterface {
  private ecsClient: ECSClient;
  private s3Client: ReturnType<typeof createS3Client>;
  private logger: Logger;
  lastRunId: string | null = null;

  constructor(logger: Logger, region?: string) {
    this.logger = logger;
    // Get region from config, will be passed in run() method
    this.ecsClient = new ECSClient({ region: region || 'us-east-1', maxAttempts: 3, retryMode: 'adaptive' });
    this.s3Client = createS3Client(region || 'us-east-1');
  }

  async run(options: RunOptions, config: CheaptestConfig): Promise<RunSummary> {
    // Validate config before making any AWS calls
    if (!config.aws.subnets?.length) {
      throw new Error('No subnets configured. Add aws.subnets to your .cheaptest.yml');
    }
    if (!config.aws.securityGroups?.length) {
      throw new Error('No security groups configured. Add aws.securityGroups to your .cheaptest.yml');
    }
    if (!config.aws.taskDefinition) {
      throw new Error('No task definition configured. Add aws.taskDefinition to your .cheaptest.yml');
    }

    // Update clients with correct region from config
    this.ecsClient = new ECSClient({ region: config.aws.region, maxAttempts: 3, retryMode: 'adaptive' });
    this.s3Client = createS3Client(config.aws.region);
    this.config = config;

    const runId = `run-${Date.now()}`;
    this.lastRunId = runId;
    const startTime = new Date();

    this.logger.info('');
    this.logger.info('='.repeat(60));
    this.logger.info(`Starting ECS Run: ${runId}`);
    this.logger.info('='.repeat(60));
    this.logger.info('');

    try {
      // Step 0: Ensure S3 bucket exists
      this.logger.startSpinner('Checking S3 bucket...');
      try {
        await this.s3Client.ensureBucketExists(config.storage.bucket);
        this.logger.succeedSpinner(`S3 bucket ready: ${config.storage.bucket}`);
      } catch (error: unknown) {
        this.logger.failSpinner(`Failed to access/create bucket: ${getErrorMessage(error)}`);
        throw error;
      }

      // Step 1: Upload test code to S3
      await this.uploadTestCode(config.tests.directory, runId, config);

      // Step 2: Upload shard configuration to S3
      await this.uploadShards(options.shards!, runId, config);

      // Step 3: Create ECS tasks
      const taskArns = await this.createTasks(runId, options.shards!, config);

      // Step 4: Wait for tasks to complete
      await this.waitForCompletion(taskArns, runId, config);

      // Step 5: Aggregate results (even if some tasks had test failures)
      const results = await this.aggregateResults(runId, options.shards!.length, config);

      // Check if we got all results
      if (results.length < options.shards!.length) {
        throw new Error(
          `Failed to collect all shard results: got ${results.length}/${options.shards!.length}. ` +
          `Check S3 bucket for missing shard-*.json files.`
        );
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // Calculate summary
      const summary: RunSummary = {
        runId,
        backend: 'ecs',
        totalTests: results.reduce((sum, r) => sum + r.passed + r.failed + r.skipped, 0),
        passed: results.reduce((sum, r) => sum + r.passed, 0),
        failed: results.reduce((sum, r) => sum + r.failed, 0),
        skipped: results.reduce((sum, r) => sum + r.skipped, 0),
        duration,
        cost: this.estimateCost(duration, options.shards!.length, config),
        startTime,
        endTime,
        results,
      };

      this.logger.info('');
      this.logger.info('='.repeat(60));
      this.logger.info('Run Complete');
      this.logger.info('='.repeat(60));
      this.logger.success(`Passed: ${summary.passed}`);
      if (summary.failed > 0) {
        this.logger.error(`Failed: ${summary.failed}`);
      }
      if (summary.skipped > 0) {
        this.logger.info(`Skipped: ${summary.skipped}`);
      }
      this.logger.info(`Duration: ${(duration / 1000).toFixed(2)}s`);
      this.logger.info(`Estimated Cost: $${summary.cost.toFixed(4)}`);
      this.logger.info('');

      return summary;
    } catch (error) {
      this.logger.error(`Run failed: ${error}`);
      throw error;
    }
  }

  async status(_runId: string): Promise<RunStatus> {
    throw new Error('Status not implemented yet');
  }

  async cancel(runId: string): Promise<void> {
    const config = this.config;
    if (!config) {
      throw new Error('Backend not initialized. Call run() or setConfig() first.');
    }

    // Load task ARNs from S3
    const tasksData = await this.s3Client.downloadJSON<{
      taskArns: string[];
      cluster: string;
    }>(config.storage.bucket, `runs/${runId}/tasks.json`);

    for (const taskArn of tasksData.taskArns) {
      try {
        await this.ecsClient.send(new StopTaskCommand({
          cluster: tasksData.cluster,
          task: taskArn,
          reason: 'Cancelled by cheaptest',
        }));
      } catch {
        // Task may already be stopped
      }
    }
  }

  private config: CheaptestConfig | null = null;

  private async uploadTestCode(
    directory: string,
    runId: string,
    config: CheaptestConfig
  ): Promise<void> {
    this.logger.startSpinner('Uploading test code to S3...');

    try {
      const testCodeKey = `runs/${runId}/test-code.tar.gz`;

      await this.s3Client.uploadDirectory(
        directory,
        config.storage.bucket,
        testCodeKey
      );

      this.logger.succeedSpinner(
        `Test code uploaded to s3://${config.storage.bucket}/${testCodeKey}`
      );
    } catch (error: unknown) {
      this.logger.failSpinner(`Failed to upload test code: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  private async uploadShards(
    shards: any[],
    runId: string,
    config: CheaptestConfig
  ): Promise<void> {
    this.logger.startSpinner('Uploading shard configuration...');

    try {
      const shardsKey = `runs/${runId}/shards.json`;

      await this.s3Client.uploadJSON(
        config.storage.bucket,
        shardsKey,
        shards,
        {
          runId,
          timestamp: new Date().toISOString(),
          framework: config.tests.framework,
          totalShards: shards.length.toString(),
        }
      );

      this.logger.succeedSpinner(
        `Shard configuration uploaded (${shards.length} shards)`
      );
    } catch (error: unknown) {
      this.logger.failSpinner(`Failed to upload shards: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  private async createTasks(
    runId: string,
    shards: any[],
    config: CheaptestConfig
  ): Promise<string[]> {
    this.logger.startSpinner(`Creating ${shards.length} ECS tasks...`);

    try {
      const taskArns: string[] = [];

      for (let i = 0; i < shards.length; i++) {
        const shard = shards[i];

        const response = await this.ecsClient.send(
          new RunTaskCommand({
            cluster: config.aws.cluster,
            taskDefinition: config.aws.taskDefinition,
            launchType: 'FARGATE',
            networkConfiguration: {
              awsvpcConfiguration: {
                subnets: config.aws.subnets,
                securityGroups: config.aws.securityGroups,
                assignPublicIp: 'ENABLED',
              },
            },
            overrides: {
              containerOverrides: [
                {
                  name: 'cheaptest-worker',
                  environment: [
                    { name: 'RUN_ID', value: runId },
                    { name: 'SHARD_ID', value: shard.id.toString() },
                    { name: 'S3_BUCKET', value: config.storage.bucket },
                    { name: 'AWS_REGION', value: config.aws.region },
                    { name: 'TEST_FRAMEWORK', value: config.tests.framework },
                    { name: 'TEST_TIMEOUT', value: (config.execution.timeout * 60 * 1000).toString() },
                  ],
                },
              ],
            },
            tags: [
              { key: 'CheaptestRunId', value: runId },
              { key: 'CheaptestShard', value: shard.id.toString() },
              { key: 'CheaptestFramework', value: config.tests.framework },
            ],
          })
        );

        if (response.tasks && response.tasks.length > 0) {
          const taskArn = response.tasks[0].taskArn!;
          taskArns.push(taskArn);

          if (config.output.verbose) {
            this.logger.debug(`  Shard ${shard.id}: ${taskArn}`);
          }
        } else {
          throw new Error(`Failed to create task for shard ${shard.id}`);
        }

        if (i < shards.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      this.logger.succeedSpinner(`${taskArns.length} ECS tasks created`);

      // Persist task ARNs to S3 for the status command
      try {
        const tasksKey = `runs/${runId}/tasks.json`;
        await this.s3Client.uploadJSON(
          config.storage.bucket,
          tasksKey,
          {
            taskArns,
            cluster: config.aws.cluster,
            region: config.aws.region,
            createdAt: new Date().toISOString(),
          }
        );
      } catch (err: unknown) {
        // Non-fatal: status command will fall back to S3-only mode
        if (config.output.verbose) {
          this.logger.debug(`Warning: could not persist task ARNs: ${getErrorMessage(err)}`);
        }
      }

      return taskArns;
    } catch (error: unknown) {
      this.logger.failSpinner(`Failed to create ECS tasks: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  private async waitForCompletion(
    taskArns: string[],
    runId: string,
    config: CheaptestConfig
  ): Promise<{ failedTasks: Task[] }> {
    this.logger.info('');
    this.logger.startSpinner('Waiting for tasks to complete...');

    const startTime = Date.now();
    // Convert timeout from minutes to milliseconds, with 1.5x buffer
    const timeout = config.execution.timeout * 60 * 1000 * 1.5;

    while (true) {
      const elapsed = Date.now() - startTime;

      if (elapsed > timeout) {
        this.logger.failSpinner('Tasks timed out');
        // Stop orphaned tasks to prevent cost leakage
        for (const taskArn of taskArns) {
          try {
            await this.ecsClient.send(new StopTaskCommand({
              cluster: config.aws.cluster,
              task: taskArn,
              reason: 'Timed out by cheaptest CLI',
            }));
          } catch {
            // Task may already be stopped
          }
        }
        throw new Error('Tasks exceeded timeout. Running tasks have been stopped.');
      }

      const response = await this.ecsClient.send(
        new DescribeTasksCommand({
          cluster: config.aws.cluster,
          tasks: taskArns,
        })
      );

      const tasks = response.tasks || [];

      const running = tasks.filter(t => t.lastStatus === 'RUNNING').length;
      const stopped = tasks.filter(t => t.lastStatus === 'STOPPED').length;
      const pending = tasks.filter(t => t.lastStatus === 'PENDING').length;

      const progress = `${stopped}/${taskArns.length} complete`;
      this.logger.updateSpinner(`Running tasks... ${progress} (${(elapsed / 1000).toFixed(0)}s)`);

      if (config.output.verbose) {
        this.logger.debug(`  Pending: ${pending}, Running: ${running}, Stopped: ${stopped}`);
      }

      if (stopped === taskArns.length) {
        const failedTasks = tasks.filter(t => {
          const exitCode = t.containers?.[0]?.exitCode;
          return exitCode !== undefined && exitCode !== 0;
        });

        if (failedTasks.length > 0) {
          // Log failures but don't throw - allow aggregation to collect results first
          this.logger.stopSpinner();
          this.logger.warn(`${taskArns.length} tasks completed (${failedTasks.length} with test failures)`);

          if (config.output.verbose) {
            failedTasks.forEach(task => {
              const container = task.containers?.[0];
              this.logger.warn(
                `  Task ${task.taskArn?.split('/').pop()} exited with code ${container?.exitCode}`
              );
              if (container?.reason) {
                this.logger.warn(`  Reason: ${container.reason}`);
              }
            });
          }
        } else {
          this.logger.succeedSpinner(`All ${taskArns.length} tasks completed successfully`);
        }

        return { failedTasks };
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  private async aggregateResults(
    runId: string,
    shardCount: number,
    config: CheaptestConfig
  ): Promise<TestResult[]> {
    this.logger.info('');
    this.logger.startSpinner('Aggregating results from S3...');

    // Wait briefly for S3 eventual consistency after tasks stop
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const results: TestResult[] = [];
      const failedShards: number[] = [];

      for (let i = 0; i < shardCount; i++) {
        const resultKey = `runs/${runId}/results/shard-${i}.json`;

        try {
          const result = await withRetry(
            () => this.s3Client.downloadJSON<TestResult>(config.storage.bucket, resultKey),
            {
              maxAttempts: 5,
              baseDelayMs: 1000,
              maxDelayMs: 15000,
              onRetry: (attempt) => {
                if (config.output.verbose) {
                  this.logger.debug(`  Shard ${i} not ready, retry ${attempt}...`);
                }
              },
            },
          );
          results.push(result);
        } catch (err: unknown) {
          this.logger.warn(`  Failed to download results for shard ${i} after retries`);
          if (config.output.verbose) {
            this.logger.debug(`  Error: ${getErrorMessage(err)}`);
          }
          failedShards.push(i);
        }

        this.logger.updateSpinner(`Aggregating results from S3... (${results.length}/${shardCount})`);
      }

      if (failedShards.length > 0) {
        this.logger.stopSpinner();
        this.logger.warn(`Could not retrieve results for shards: ${failedShards.join(', ')}`);
      } else {
        this.logger.succeedSpinner(`Aggregated results from ${results.length}/${shardCount} shards`);
      }

      return results;
    } catch (error: unknown) {
      this.logger.failSpinner(`Failed to aggregate results: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  private estimateCost(
    durationMs: number,
    shardCount: number,
    config: CheaptestConfig
  ): number {
    const durationHours = durationMs / (1000 * 60 * 60);
    const vCPU = config.execution.cpu / 1024;
    const memoryGB = config.execution.memory / 1024;

    const vCpuCost = vCPU * 0.04048 * durationHours * shardCount;
    const memoryCost = memoryGB * 0.004445 * durationHours * shardCount;

    return vCpuCost + memoryCost;
  }
}