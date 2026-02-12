import { TestRunner } from './runner';
import { S3ClientWrapper } from './s3-client';

interface WorkerConfig {
  runId: string;
  shardId: number;
  bucket: string;
  region: string;
  framework: 'playwright' | 'cypress' | 'selenium';
  timeout: number;
}

async function main() {
  try {
    console.log('='.repeat(60));
    console.log('Cheaptest Worker Starting');
    console.log('='.repeat(60));

    // Get configuration from environment variables
    const config: WorkerConfig = {
      runId: process.env.RUN_ID || '',
      shardId: parseInt(process.env.SHARD_ID || '0'),
      bucket: process.env.S3_BUCKET || '',
      region: process.env.AWS_REGION || 'us-east-1',
      framework: (process.env.TEST_FRAMEWORK || 'playwright') as any,
      timeout: parseInt(process.env.TEST_TIMEOUT || '300000'),
    };

    console.log('Configuration:');
    console.log(`  Run ID: ${config.runId}`);
    console.log(`  Shard ID: ${config.shardId}`);
    console.log(`  Bucket: ${config.bucket}`);
    console.log(`  Framework: ${config.framework}`);
    console.log(`  Timeout: ${config.timeout}ms`);
    console.log('');

    // Validate required config
    if (!config.runId || !config.bucket) {
      throw new Error('Missing required configuration: RUN_ID and S3_BUCKET must be set');
    }

    // Initialize S3 client
    const s3Client = new S3ClientWrapper(config.region);

    // Download test code from S3
    console.log('[INFO] Downloading test code...');
    const testCodeKey = `runs/${config.runId}/test-code.tar.gz`;
    const workspace = '/workspace';
    
    await s3Client.downloadAndExtract(config.bucket, testCodeKey, workspace);
    console.log('[OK] Test code downloaded and extracted');
    console.log('');

    // Download shard configuration
    console.log('[INFO] Downloading shard configuration...');
    const shardsKey = `runs/${config.runId}/shards.json`;
    const shards = await s3Client.downloadJSON<any[]>(config.bucket, shardsKey);
    const shard = shards.find(s => s.id === config.shardId);

    if (!shard) {
      throw new Error(`Shard ${config.shardId} not found in configuration`);
    }

    console.log(`[OK] Shard configuration loaded: ${shard.files.length} test files`);
    console.log('');

    // Run tests
    console.log('[TEST] Running tests...');
    console.log('-'.repeat(60));

    const runner = new TestRunner({
      framework: config.framework,
      workspace,
      timeout: config.timeout,
      shard,
    });

    let result;
    let runnerError: Error | null = null;

    try {
      result = await runner.run();
    } catch (error: unknown) {
      // Capture error but continue to upload partial results
      runnerError = error instanceof Error ? error : new Error(String(error));
      console.error('[ERROR] Test runner error:', runnerError.message);

      // Create error result so we still upload something
      result = {
        shard: config.shardId,
        passed: 0,
        failed: shard.files.length,
        skipped: 0,
        duration: 0,
        tests: shard.files.map((f: any) => ({
          name: f.relativePath,
          file: f.relativePath,
          status: 'failed' as const,
          duration: 0,
          error: `Test runner crashed: ${runnerError!.message}`,
        })),
      };
    }

    console.log('-'.repeat(60));
    console.log(runnerError ? '[WARN] Tests completed with errors' : '[OK] Tests completed');
    console.log(`  Passed: ${result.passed}`);
    console.log(`  Failed: ${result.failed}`);
    console.log(`  Skipped: ${result.skipped}`);
    console.log(`  Duration: ${(result.duration / 1000).toFixed(2)}s`);
    console.log('');

    // Upload results to S3 (even on failure)
    console.log('[INFO] Uploading results...');
    const resultsKey = `runs/${config.runId}/results/shard-${config.shardId}.json`;

    await s3Client.uploadJSON(config.bucket, resultsKey, result, {
      runId: config.runId,
      shardId: config.shardId.toString(),
      framework: config.framework,
      timestamp: new Date().toISOString(),
      ...(runnerError && { error: runnerError.message }),
    });

    console.log(`[OK] Results uploaded to ${resultsKey}`);
    console.log('');

    // Exit with appropriate code
    const exitCode = result.failed > 0 || runnerError ? 1 : 0;
    
    console.log('='.repeat(60));
    console.log(`Worker completed with exit code ${exitCode}`);
    console.log('='.repeat(60));

    process.exit(exitCode);

  } catch (error) {
    console.error('');
    console.error('[ERROR] Worker failed:');
    console.error(error);
    console.error('');
    process.exit(1);
  }
}

// Handle signals
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  process.exit(143);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  process.exit(130);
});

main();