import chalk from 'chalk';
import { ECSClient, DescribeTasksCommand, StopTaskCommand } from '@aws-sdk/client-ecs';
import { Logger } from '../utils/logger';
import { loadConfig, findConfigFile } from '../utils/config';
import { createS3Client } from '../aws/s3-client';
import { getErrorMessage } from '../utils/retry';

interface CancelOptions {
  force?: boolean;
}

interface TasksManifest {
  taskArns: string[];
  cluster: string;
  region: string;
  createdAt: string;
}

export async function cancelCommand(runId: string, options: CancelOptions): Promise<void> {
  const logger = new Logger();

  if (!runId) {
    logger.error('Run ID is required');
    logger.info('');
    logger.info(`Usage: ${chalk.cyan('cheaptest cancel <runId>')}`);
    logger.info(`Example: ${chalk.cyan('cheaptest cancel run-1707600000000')}`);
    process.exit(1);
  }

  try {
    const configPath = await findConfigFile() || '.cheaptest.yml';
    const config = await loadConfig(configPath);
    const s3Client = createS3Client(config.aws.region);

    logger.header('Cancel Run');
    logger.info('');

    // 1. Load tasks.json to get task ARNs
    logger.startSpinner(`Loading run ${runId}...`);

    let tasksManifest: TasksManifest;
    try {
      tasksManifest = await s3Client.downloadJSON<TasksManifest>(
        config.storage.bucket,
        `runs/${runId}/tasks.json`,
      );
    } catch {
      logger.failSpinner('Run not found or task tracking unavailable');
      logger.error(`Could not load task data for run: ${runId}`);
      logger.info('');
      logger.info('Cancel requires task ARN tracking (tasks.json in S3).');
      logger.info('Runs created before this feature was added cannot be cancelled via CLI.');
      process.exit(1);
    }

    // 2. Describe tasks to find which are still active
    const ecsClient = new ECSClient({ region: tasksManifest.region, maxAttempts: 3, retryMode: 'adaptive' });

    const batchSize = 100;
    const allTasks: any[] = [];
    for (let i = 0; i < tasksManifest.taskArns.length; i += batchSize) {
      const batch = tasksManifest.taskArns.slice(i, i + batchSize);
      const resp = await ecsClient.send(new DescribeTasksCommand({
        cluster: tasksManifest.cluster,
        tasks: batch,
      }));
      allTasks.push(...(resp.tasks || []));
    }

    const activeTasks = allTasks.filter(t =>
      t.lastStatus !== 'STOPPED' && t.lastStatus !== 'DEPROVISIONING'
    );
    const stoppedTasks = allTasks.length - activeTasks.length;

    logger.succeedSpinner(`Found ${allTasks.length} tasks (${activeTasks.length} active, ${stoppedTasks} already stopped)`);
    logger.info('');

    if (activeTasks.length === 0) {
      logger.info('No active tasks to cancel. All tasks have already stopped.');
      return;
    }

    // 3. Confirmation (unless --force)
    if (!options.force) {
      logger.warn(`About to stop ${activeTasks.length} running ECS task(s) for run ${chalk.cyan(runId)}`);
      logger.info('');

      for (const task of activeTasks) {
        const shardTag = task.tags?.find((t: any) => t.key === 'CheaptestShard');
        const shardLabel = shardTag ? `Shard ${shardTag.value}` : 'Unknown shard';
        const taskId = task.taskArn?.split('/').pop();
        logger.info(`  ${chalk.blue('\u25B6')} ${shardLabel} - ${chalk.gray(taskId)} [${task.lastStatus}]`);
      }

      logger.info('');
      logger.warn('Use --force to skip this confirmation and stop tasks immediately.');
      logger.info(`Run: ${chalk.cyan(`cheaptest cancel ${runId} --force`)}`);
      return;
    }

    // 4. Stop each active task
    logger.startSpinner(`Stopping ${activeTasks.length} tasks...`);

    let stopped = 0;
    let errors = 0;

    for (const task of activeTasks) {
      try {
        await ecsClient.send(new StopTaskCommand({
          cluster: tasksManifest.cluster,
          task: task.taskArn!,
          reason: 'Cancelled by cheaptest cancel command',
        }));
        stopped++;
        logger.updateSpinner(`Stopping tasks... ${stopped}/${activeTasks.length}`);
      } catch (err: unknown) {
        errors++;
        const taskId = task.taskArn?.split('/').pop();
        logger.debug(`Failed to stop task ${taskId}: ${getErrorMessage(err)}`);
      }
    }

    if (errors > 0) {
      logger.stopSpinner();
      logger.warn(`Stopped ${stopped}/${activeTasks.length} tasks (${errors} failed)`);
    } else {
      logger.succeedSpinner(`Stopped ${stopped} tasks`);
    }

    logger.info('');

    // 5. Summary
    logger.info(`  Run ID:       ${chalk.cyan(runId)}`);
    logger.info(`  Tasks stopped: ${chalk.yellow(String(stopped))}`);
    if (stoppedTasks > 0) {
      logger.info(`  Already stopped: ${chalk.gray(String(stoppedTasks))}`);
    }
    if (errors > 0) {
      logger.info(`  Errors:       ${chalk.red(String(errors))}`);
    }
    logger.info('');

    logger.info('Partial results (if any) are still available in S3.');
    logger.info(`Check with: ${chalk.cyan(`cheaptest status ${runId}`)}`);
    logger.info('');

  } catch (err: unknown) {
    logger.error(`Failed to cancel run: ${getErrorMessage(err)}`);
    process.exit(1);
  }
}
