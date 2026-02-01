import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
  Task,
  StopTaskCommand,
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

export class ECSBackend implements BackendInterface {
  private ecsClient: ECSClient;
  private s3Client: ReturnType<typeof createS3Client>;
  private logger: Logger;

  constructor(logger: Logger, region?: string) {
    this.logger = logger;
    // Get region from config, will be passed in run() method
    this.ecsClient = new ECSClient({ region: region || 'us-east-1' });
    this.s3Client = createS3Client(region || 'us-east-1');
  }

  async run(options: RunOptions, config: CheaptestConfig): Promise<RunSummary> {
    // Update clients with correct region from config
    this.ecsClient = new ECSClient({ region: config.aws.region });
    this.s3Client = createS3Client(config.aws.region);

    const runId = `run-${Date.now()}`;
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
      } catch (error: any) {
        this.logger.failSpinner(`Failed to access/create bucket: ${error.message}`);
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

      // Step 5: Aggregate results
      const results = await this.aggregateResults(runId, options.shards!.length, config);

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
      };

      this.logger.info('');
      this.logger.info('='.repeat(60));
      this.logger.info('Run Complete');
      this.logger.info('='.repeat(60));
      this.logger.success(`✓ Passed: ${summary.passed}`);
      if (summary.failed > 0) {
        this.logger.error(`✗ Failed: ${summary.failed}`);
      }
      if (summary.skipped > 0) {
        this.logger.info(`⊘ Skipped: ${summary.skipped}`);
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

  async status(runId: string): Promise<RunStatus> {
    throw new Error('Status not implemented yet');
  }

  async cancel(runId: string): Promise<void> {
    throw new Error('Cancel not implemented yet');
  }

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
    } catch (error: any) {
      this.logger.failSpinner(`Failed to upload test code: ${error.message}`);
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
    } catch (error: any) {
      this.logger.failSpinner(`Failed to upload shards: ${error.message}`);
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
                    { name: 'TEST_TIMEOUT', value: config.execution.timeout.toString() },
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
      return taskArns;
    } catch (error: any) {
      this.logger.failSpinner(`Failed to create ECS tasks: ${error.message}`);
      throw error;
    }
  }

  private async waitForCompletion(
    taskArns: string[],
    runId: string,
    config: CheaptestConfig
  ): Promise<void> {
    this.logger.info('');
    this.logger.startSpinner('Waiting for tasks to complete...');

    const startTime = Date.now();
    const timeout = config.execution.timeout * 1.5;

    while (true) {
      const elapsed = Date.now() - startTime;

      if (elapsed > timeout) {
        this.logger.failSpinner('Tasks timed out');
        throw new Error('Tasks exceeded timeout');
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
        const failed = tasks.filter(t => {
          const exitCode = t.containers?.[0]?.exitCode;
          return exitCode !== undefined && exitCode !== 0;
        });

        if (failed.length > 0) {
          this.logger.failSpinner(`${failed.length} tasks failed`);

          if (config.output.verbose) {
            failed.forEach(task => {
              const container = task.containers?.[0];
              this.logger.error(
                `  Task ${task.taskArn?.split('/').pop()} exited with code ${container?.exitCode}`
              );
              if (container?.reason) {
                this.logger.error(`  Reason: ${container.reason}`);
              }
            });
          }

          throw new Error(`${failed.length} tasks failed`);
        }

        this.logger.succeedSpinner(`All ${taskArns.length} tasks completed successfully`);
        break;
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

    try {
      const results: TestResult[] = [];

      for (let i = 0; i < shardCount; i++) {
        const resultKey = `runs/${runId}/results/shard-${i}.json`;

        try {
          const result = await this.s3Client.downloadJSON<TestResult>(
            config.storage.bucket,
            resultKey
          );

          results.push(result);
        } catch (error: any) {
          this.logger.warn(`  Warning: Could not download results for shard ${i}`);
          if (config.output.verbose) {
            this.logger.debug(`  Error: ${error.message}`);
          }
        }
      }

      this.logger.succeedSpinner(`Aggregated results from ${results.length}/${shardCount} shards`);
      return results;
    } catch (error: any) {
      this.logger.failSpinner(`Failed to aggregate results: ${error.message}`);
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