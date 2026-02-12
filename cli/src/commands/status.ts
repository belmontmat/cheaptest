import chalk from 'chalk';
import { ECSClient, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { Logger } from '../utils/logger';
import { loadConfig, findConfigFile } from '../utils/config';
import { createS3Client } from '../aws/s3-client';
import { S3ClientWrapper } from '../aws/s3-client';
import { CheaptestConfig, TestResult, TestShard, RunStatus } from '../types';
import { getErrorMessage } from '../utils/retry';

interface StatusOptions {
  watch?: boolean;
}

interface TasksManifest {
  taskArns: string[];
  cluster: string;
  region: string;
  createdAt: string;
}

type ShardState = 'pending' | 'running' | 'stopped' | 'completed' | 'failed' | 'unknown';

interface ShardStatusInfo {
  shardId: number;
  state: ShardState;
  result?: TestResult;
  ecsStatus?: string;
  exitCode?: number;
}

interface StatusData {
  shards: TestShard[];
  shardStatuses: ShardStatusInfo[];
  results: TestResult[];
  metadata: Record<string, string>;
  hasTaskArns: boolean;
}

export async function statusCommand(runId: string, options: StatusOptions): Promise<void> {
  const logger = new Logger();

  if (!runId) {
    logger.error('Run ID is required');
    logger.info('');
    logger.info(`Usage: ${chalk.cyan('cheaptest status <runId>')}`);
    logger.info(`Example: ${chalk.cyan('cheaptest status run-1707600000000')}`);
    process.exit(1);
  }

  try {
    const configPath = await findConfigFile() || '.cheaptest.yml';
    const config = await loadConfig(configPath);
    const s3Client = createS3Client(config.aws.region);

    if (options.watch) {
      await watchStatus(runId, config, s3Client, logger);
    } else {
      logger.header('Run Status');
      logger.info('');
      await showStatus(runId, config, s3Client, logger, false);
    }
  } catch (err: unknown) {
    logger.error(`Failed to get status: ${getErrorMessage(err)}`);
    process.exit(1);
  }
}

async function gatherStatus(
  runId: string,
  config: CheaptestConfig,
  s3Client: S3ClientWrapper,
): Promise<StatusData> {
  // 1. Load shards.json (validates run exists)
  let shards: TestShard[];
  try {
    shards = await s3Client.downloadJSON<TestShard[]>(
      config.storage.bucket,
      `runs/${runId}/shards.json`,
    );
  } catch {
    throw new Error(`Run not found: ${runId}`);
  }

  // 2. Get shards.json metadata for timestamps/framework
  let metadata: Record<string, string> = {};
  try {
    metadata = await s3Client.getMetadata(config.storage.bucket, `runs/${runId}/shards.json`);
  } catch {
    // Non-critical
  }

  // 3. List completed result files
  const resultKeys = await s3Client.list({
    bucket: config.storage.bucket,
    prefix: `runs/${runId}/results/`,
  });
  const completedKeys = resultKeys.filter(k => k.endsWith('.json'));

  // 4. Download completed results
  const results: TestResult[] = [];
  for (const key of completedKeys) {
    try {
      const result = await s3Client.downloadJSON<TestResult>(config.storage.bucket, key);
      results.push(result);
    } catch {
      // Skip corrupt results
    }
  }

  // 5. Try to load task ARNs for live ECS state
  let ecsTaskStates: Map<number, { status: string; exitCode?: number }> | null = null;
  let hasTaskArns = false;

  try {
    const tasksManifest = await s3Client.downloadJSON<TasksManifest>(
      config.storage.bucket,
      `runs/${runId}/tasks.json`,
    );
    hasTaskArns = true;

    const ecsClient = new ECSClient({ region: tasksManifest.region, maxAttempts: 3, retryMode: 'adaptive' });
    const allTasks: any[] = [];

    // DescribeTasksCommand supports max 100 tasks per call
    const batchSize = 100;
    for (let i = 0; i < tasksManifest.taskArns.length; i += batchSize) {
      const batch = tasksManifest.taskArns.slice(i, i + batchSize);
      const resp = await ecsClient.send(new DescribeTasksCommand({
        cluster: tasksManifest.cluster,
        tasks: batch,
      }));
      allTasks.push(...(resp.tasks || []));
    }

    ecsTaskStates = new Map();
    for (const task of allTasks) {
      const shardTag = task.tags?.find((t: any) => t.key === 'CheaptestShard');
      if (shardTag?.value !== undefined) {
        const shardId = parseInt(shardTag.value);
        ecsTaskStates.set(shardId, {
          status: task.lastStatus || 'UNKNOWN',
          exitCode: task.containers?.[0]?.exitCode,
        });
      }
    }
  } catch {
    // No task ARNs available or ECS query failed — S3-only mode
  }

  // 6. Build per-shard status
  const shardStatuses: ShardStatusInfo[] = shards.map(shard => {
    const result = results.find(r => r.shard === shard.id);
    const ecsState = ecsTaskStates?.get(shard.id);

    // S3 result is the source of truth
    if (result) {
      return {
        shardId: shard.id,
        state: (result.failed > 0 ? 'failed' : 'completed') as ShardState,
        result,
        ecsStatus: ecsState?.status,
        exitCode: ecsState?.exitCode,
      };
    }

    // No result yet — use ECS state if available
    if (ecsState) {
      return {
        shardId: shard.id,
        state: mapEcsStatus(ecsState.status),
        ecsStatus: ecsState.status,
        exitCode: ecsState.exitCode,
      };
    }

    return {
      shardId: shard.id,
      state: 'unknown' as ShardState,
    };
  });

  return { shards, shardStatuses, results, metadata, hasTaskArns };
}

async function showStatus(
  runId: string,
  config: CheaptestConfig,
  s3Client: S3ClientWrapper,
  logger: Logger,
  quiet: boolean,
): Promise<RunStatus> {
  if (!quiet) {
    logger.startSpinner(`Checking run ${runId}...`);
  }

  let data: StatusData;
  try {
    data = await gatherStatus(runId, config, s3Client);
  } catch (err: unknown) {
    if (!quiet) {
      logger.failSpinner('Run not found');
    }
    logger.error(getErrorMessage(err));
    logger.info('');
    logger.info('Make sure the run ID is correct. Run IDs look like: run-1707600000000');
    process.exit(1);
  }

  if (!quiet) {
    logger.succeedSpinner('Status loaded');
    logger.info('');
  }

  renderStatus(runId, data, logger);

  // Build RunStatus return value
  const completed = data.shardStatuses.filter(s => s.state === 'completed' || s.state === 'failed').length;
  const running = data.shardStatuses.filter(s => s.state === 'running').length;
  const failed = data.shardStatuses.filter(s => s.state === 'failed').length;

  let overallStatus: RunStatus['status'];
  if (completed === data.shards.length) {
    overallStatus = failed > 0 ? 'failed' : 'completed';
  } else if (running > 0) {
    overallStatus = 'running';
  } else if (completed > 0) {
    overallStatus = 'running'; // Some done, waiting on rest
  } else {
    overallStatus = 'pending';
  }

  return {
    runId,
    status: overallStatus,
    progress: {
      total: data.shards.length,
      completed,
      running,
      failed,
    },
    startTime: new Date(data.metadata.timestamp || Date.now()),
  };
}

function renderStatus(runId: string, data: StatusData, logger: Logger): void {
  const { shards, shardStatuses, results, metadata, hasTaskArns } = data;

  // --- Run Info ---
  logger.info(`  Run ID:       ${chalk.cyan(runId)}`);
  if (metadata.framework) {
    logger.info(`  Framework:    ${chalk.cyan(metadata.framework)}`);
  }
  logger.info(`  Total Shards: ${chalk.yellow(String(shards.length))}`);
  if (metadata.timestamp) {
    const started = new Date(metadata.timestamp);
    const elapsed = Date.now() - started.getTime();
    logger.info(`  Started:      ${chalk.gray(started.toLocaleString())} (${formatDuration(elapsed)} ago)`);
  }
  if (!hasTaskArns) {
    logger.info(`  ${chalk.gray('(ECS task tracking not available for this run)')}`);
  }
  logger.info('');

  // --- Counts ---
  const completed = shardStatuses.filter(s => s.state === 'completed').length;
  const failed = shardStatuses.filter(s => s.state === 'failed').length;
  const running = shardStatuses.filter(s => s.state === 'running').length;
  const pending = shardStatuses.filter(s => s.state === 'pending').length;
  const stopped = shardStatuses.filter(s => s.state === 'stopped').length;
  const unknown = shardStatuses.filter(s => s.state === 'unknown').length;

  // --- Progress Bar ---
  const total = shards.length;
  const barWidth = 40;
  const completedWidth = Math.round((completed / total) * barWidth);
  const failedWidth = Math.round((failed / total) * barWidth);
  const runningWidth = Math.round((running / total) * barWidth);
  const remaining = Math.max(0, barWidth - completedWidth - failedWidth - runningWidth);

  const bar =
    chalk.green('\u2588'.repeat(completedWidth)) +
    chalk.red('\u2588'.repeat(failedWidth)) +
    chalk.blue('\u2588'.repeat(runningWidth)) +
    chalk.gray('\u2591'.repeat(remaining));

  logger.info(`  Progress: [${bar}] ${completed + failed}/${total}`);
  logger.info('');

  // --- Status Counts ---
  const parts: string[] = [];
  if (completed > 0) parts.push(chalk.green(`Completed: ${completed}`));
  if (failed > 0) parts.push(chalk.red(`Failed: ${failed}`));
  if (running > 0) parts.push(chalk.blue(`Running: ${running}`));
  if (pending > 0) parts.push(chalk.yellow(`Pending: ${pending}`));
  if (stopped > 0) parts.push(chalk.gray(`Stopped: ${stopped}`));
  if (unknown > 0) parts.push(chalk.gray(`Unknown: ${unknown}`));
  logger.info(`  ${parts.join('  ')}`);
  logger.info('');

  // --- Per-Shard Details ---
  logger.info('  Shards:');
  for (const shard of shardStatuses) {
    const icon = stateIcon(shard.state);
    const ecsLabel = shard.ecsStatus ? chalk.gray(` [${shard.ecsStatus}]`) : '';
    const testCount = shard.result
      ? chalk.gray(` (${shard.result.passed}P/${shard.result.failed}F/${shard.result.skipped}S)`)
      : '';
    logger.info(`    ${icon} Shard ${shard.shardId}${ecsLabel}${testCount}`);
  }
  logger.info('');

  // --- Aggregated Test Results ---
  if (results.length > 0) {
    const totalTests = results.reduce((s, r) => s + r.passed + r.failed + r.skipped, 0);
    const totalPassed = results.reduce((s, r) => s + r.passed, 0);
    const totalFailed = results.reduce((s, r) => s + r.failed, 0);
    const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
    const totalDuration = results.reduce((s, r) => s + r.duration, 0);

    const label = completed + failed < total ? 'Test Results (partial)' : 'Test Results';
    logger.info(`  ${chalk.bold(label)}:`);
    logger.info(`    Total:   ${totalTests}`);
    if (totalPassed > 0) logger.info(`    ${chalk.green('Passed:')}  ${totalPassed}`);
    if (totalFailed > 0) logger.info(`    ${chalk.red('Failed:')}  ${totalFailed}`);
    if (totalSkipped > 0) logger.info(`    ${chalk.yellow('Skipped:')} ${totalSkipped}`);
    logger.info(`    Duration: ${formatDuration(totalDuration)}`);
    logger.info('');

    // --- Failed Test Details ---
    if (totalFailed > 0) {
      logger.info(`  ${chalk.bold.red('Failed Tests')}:`);
      for (const result of results) {
        const failedTests = result.tests.filter(t => t.status === 'failed');
        for (const test of failedTests) {
          logger.info(`    ${chalk.red('\u2716')} Shard ${result.shard}: ${chalk.cyan(test.file)} - ${test.name}`);
          if (test.error) {
            logger.info(`      ${chalk.gray(test.error.substring(0, 150))}`);
          }
        }
      }
      logger.info('');
    }
  }
}

async function watchStatus(
  runId: string,
  config: CheaptestConfig,
  s3Client: S3ClientWrapper,
  logger: Logger,
): Promise<void> {
  const POLL_INTERVAL_MS = 5000;

  process.on('SIGINT', () => {
    logger.info('');
    logger.info('Watch mode stopped.');
    process.exit(0);
  });

  while (true) {
    // Clear screen and move cursor to top
    process.stdout.write('\x1B[2J\x1B[0f');

    logger.header(`Run Status (watching) - ${new Date().toLocaleTimeString()}`);
    logger.info('');

    const status = await showStatus(runId, config, s3Client, logger, true);

    if (status.status === 'completed' || status.status === 'failed') {
      logger.info('');
      if (status.status === 'completed') {
        logger.success('Run completed. Exiting watch mode.');
      } else {
        logger.error('Run completed with failures. Exiting watch mode.');
      }
      break;
    }

    logger.info(chalk.gray(`Refreshing every ${POLL_INTERVAL_MS / 1000}s... Press Ctrl+C to stop.`));
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

function mapEcsStatus(ecsStatus: string): ShardState {
  switch (ecsStatus) {
    case 'PROVISIONING':
    case 'PENDING':
      return 'pending';
    case 'ACTIVATING':
    case 'RUNNING':
      return 'running';
    case 'DEACTIVATING':
    case 'STOPPING':
    case 'DEPROVISIONING':
    case 'STOPPED':
      return 'stopped';
    default:
      return 'unknown';
  }
}

function stateIcon(state: ShardState): string {
  switch (state) {
    case 'completed': return chalk.green('\u2714');
    case 'failed':    return chalk.red('\u2716');
    case 'running':   return chalk.blue('\u25B6');
    case 'pending':   return chalk.yellow('\u25CB');
    case 'stopped':   return chalk.gray('\u25A0');
    case 'unknown':   return chalk.gray('?');
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
