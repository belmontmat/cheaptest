import path from 'path';
import chalk from 'chalk';
import { createShards } from '../core/sharding';
import { RunOptions, TestFramework } from '../types';
import { Logger } from '../utils/logger';
import { loadConfig, validateConfig, findConfigFile } from '../utils/config';
import { TestParser } from '../core/test-parser';
import { ECSBackend } from '../backends/ecs';
import { KubernetesBackend } from '../backends/kubernetes';
import { getErrorMessage } from '../utils/retry';
import { writeJunitXml } from '../output/junit';

/**
 * Auto-detect test framework from directory path
 * Looks for framework names in the path (e.g., "examples/playwright" -> "playwright")
 */
function detectFrameworkFromPath(testPath: string): TestFramework | null {
  const normalizedPath = testPath.toLowerCase();

  if (normalizedPath.includes('playwright')) {
    return 'playwright';
  }
  if (normalizedPath.includes('selenium')) {
    return 'selenium';
  }
  if (normalizedPath.includes('cypress')) {
    return 'cypress';
  }

  return null;
}

export async function runCommand(options: RunOptions): Promise<void> {
  const logger = new Logger(options.verbose);
  
  try {
    // Header
    logger.header('cheaptest - Parallel E2E Test Runner');
    logger.info('');
    
    // ============================================
    // 1. LOAD CONFIGURATION
    // ============================================
    logger.startSpinner('Loading configuration...');
    
    const configPath = options.config || await findConfigFile() || '.cheaptest.yml';
    const config = await loadConfig(configPath);
    
    logger.succeedSpinner(`Loaded config from ${chalk.cyan(configPath)}`);
    
    // Validate configuration
    const errors = validateConfig(config);
    if (errors.length > 0) {
      logger.stopSpinner();
      logger.error('Configuration errors found:');
      errors.forEach(err => logger.error(`  • ${err}`));
      logger.info('');
      logger.info('Fix these errors in your .cheaptest.yml file');
      process.exit(1);
    }
    
    // ============================================
    // 2. DISCOVER TESTS
    // ============================================
    logger.info('');
    logger.startSpinner('Discovering test files...');
    
    const parser = new TestParser();

    // Resolve framework: CLI flag > auto-detect from path > config
    const testDirectory = options.tests || config.tests.directory;
    const effectiveFramework: TestFramework =
      options.framework ||
      detectFrameworkFromPath(testDirectory) ||
      config.tests.framework;

    // If framework changed from config, use framework-specific default pattern
    // (empty string tells TestParser to use framework defaults)
    const effectivePattern =
      effectiveFramework !== config.tests.framework ? '' : config.tests.pattern;

    if (options.verbose) {
      if (options.framework) {
        logger.debug(`Framework: ${effectiveFramework} (from --framework flag)`);
      } else if (detectFrameworkFromPath(testDirectory)) {
        logger.debug(`Framework: ${effectiveFramework} (auto-detected from path)`);
      } else {
        logger.debug(`Framework: ${effectiveFramework} (from config)`);
      }
    }

    let discovery;
    try {
      discovery = await parser.discover({
        directory: testDirectory,
        pattern: effectivePattern,
        framework: effectiveFramework,
        includeEstimates: true, // Get duration estimates for better sharding
      });
    } catch (err: unknown) {
      logger.failSpinner('Test discovery failed');
      logger.error(getErrorMessage(err));
      logger.info('');
      logger.info('Make sure your test directory exists and contains test files');
      logger.info(`Looking in: ${chalk.cyan(options.tests || config.tests.directory)}`);
      logger.info(`Pattern: ${chalk.cyan(config.tests.pattern)}`);
      process.exit(1);
    }
    
    logger.succeedSpinner(
      `Found ${chalk.green(discovery.totalFiles)} test files`
    );
    
    // Show detailed stats in verbose mode
    if (options.verbose) {
      const stats = parser.getStats(discovery.files);
      logger.debug(`Total size: ${(stats.totalSize / 1024).toFixed(2)} KB`);
      logger.debug(`Average file size: ${(stats.avgSize / 1024).toFixed(2)} KB`);
      logger.debug(`Test suites: ${stats.suites.join(', ')}`);
      
      if (stats.estimatedTotal) {
        const minutes = Math.floor(stats.estimatedTotal / 60000);
        const seconds = Math.floor((stats.estimatedTotal % 60000) / 1000);
        logger.debug(
          `Estimated serial duration: ${minutes}m ${seconds}s`
        );
        
        const parallelDuration = stats.estimatedTotal / options.parallel;
        const pMinutes = Math.floor(parallelDuration / 60000);
        const pSeconds = Math.floor((parallelDuration % 60000) / 1000);
        logger.debug(
          `Estimated parallel duration (${options.parallel} workers): ${pMinutes}m ${pSeconds}s`
        );
      }
      
      logger.info('');
      logger.debug('Test files discovered:');
      discovery.files.forEach(file => {
        const duration = file.estimatedDuration 
          ? chalk.gray(` (~${(file.estimatedDuration / 1000).toFixed(1)}s)`)
          : '';
        logger.debug(`  • ${file.relativePath}${duration}`);
      });
    }
    
    // ============================================
    // 3. GROUP BY SUITE (OPTIONAL DISPLAY)
    // ============================================
    if (options.verbose) {
      logger.info('');
      const suites = parser.groupBySuite(discovery.files);
      logger.debug(`Organized into ${suites.size} test suites:`);
      suites.forEach((files, suiteName) => {
        logger.debug(`  ${suiteName}: ${files.length} files`);
      });
    }
    
    // ============================================
    // 4. VALIDATE TEST COUNT VS PARALLELISM
    // ============================================
    if (discovery.totalFiles < options.parallel) {
      logger.warn('');
      logger.warn(
        `Only ${discovery.totalFiles} test files found, but parallelism is set to ${options.parallel}`
      );
      logger.warn(
        `Consider reducing --parallel to ${discovery.totalFiles} for optimal resource usage`
      );
    }
    
    // ============================================
    // 5. SHOW EXECUTION PLAN
    // ============================================
    logger.info('');
    logger.header('Execution Plan');
    logger.info('');
    
    const testDir = path.resolve(process.cwd(), testDirectory);
    
    logger.info(`  Test Directory:  ${chalk.cyan(testDir)}`);
    logger.info(`  Test Files:      ${chalk.green(discovery.totalFiles)}`);
    logger.info(`  Framework:       ${chalk.cyan(effectiveFramework)}`);
    logger.info(`  Backend:         ${chalk.cyan(options.backend)}`);
    logger.info(`  Parallelism:     ${chalk.yellow(options.parallel)} workers`);
    logger.info(`  Timeout:         ${options.timeout || config.execution.timeout} minutes`);
    logger.info(`  Retries:         ${options.retries || 0}`);
    
    if (config.execution.cpu && config.execution.memory) {
      logger.info(`  Resources:       ${config.execution.cpu} CPU, ${config.execution.memory} MB`);
    }
    
    // Show estimated costs
    const estimatedCost = calculateEstimatedCost(
      options.backend,
      options.parallel,
      config.execution.cpu,
      config.execution.memory,
      discovery.estimatedDuration || 300000 // Default 5 min if no estimate
    );
    
    logger.info(`  Estimated Cost:  ${logger.cost(estimatedCost)}`);
    logger.info('');
    
    // ============================================
    // 6. DRY RUN CHECK
    // ============================================
    if (options.dryRun) {
      logger.warn('Dry run mode - not executing tests');
      logger.info('');
      logger.info('Test files that would be executed:');
      discovery.files.forEach((file, idx) => {
        logger.info(`  ${idx + 1}. ${file.relativePath}`);
      });
      logger.info('');
      logger.info('Run without --dry-run to execute tests');
      return;
    }
    
    // ============================================
    // 7. INITIALIZE BACKEND
    // ============================================
    logger.startSpinner(`Initializing ${options.backend} backend...`);
    
    const backend = options.backend === 'kubernetes'
      ? new KubernetesBackend(logger)
      : new ECSBackend(logger);
    
    logger.succeedSpinner(`${options.backend} backend ready`);

    // Graceful shutdown: cancel ECS tasks on Ctrl+C
    if (backend instanceof ECSBackend) {
      process.on('SIGINT', async () => {
        logger.info('');
        logger.warn('Interrupt received, cancelling tasks...');
        if (backend.lastRunId) {
          try { await backend.cancel(backend.lastRunId); } catch { /* best effort */ }
        }
        process.exit(130);
      });
    }

    // ============================================
    // 8. EXECUTE TESTS
    // ============================================
    logger.info('');
    logger.header('Test Execution');
    logger.info('');
    
    const startTime = Date.now();

    // ============================================
    // CREATE SHARDS
    // ============================================
    logger.info('');
    logger.startSpinner(`Creating ${options.parallel} test shards...`);

    const shards = createShards(
      discovery.files,
      options.parallel,
      'duration-based' // Use duration-based for best balance
    );

    logger.succeedSpinner('Shards created');

    if (options.verbose) {
      const { TestSharding } = await import('../core/sharding');
      const sharding = new TestSharding();
      const visualization = sharding.visualizeShards(shards);
      logger.debug(visualization);
    }

    // Pass shards to backend
    // Override config.tests with CLI arguments
    const effectiveConfig = {
      ...config,
      tests: {
        ...config.tests,
        directory: testDirectory,
        framework: effectiveFramework,
      },
    };

    let result;
    try {
      result = await backend.run(
        {
          ...options,
          testFiles: discovery.files,
          shards,
        },
        effectiveConfig
      );
    } catch (err: unknown) {
      logger.error(`Test execution failed: ${getErrorMessage(err)}`);

      if (options.verbose && err instanceof Error && err.stack) {
        logger.info('');
        logger.debug('Stack trace:');
        logger.debug(err.stack);
      }
      
      logger.info('');
      logger.info('Troubleshooting tips:');
      logger.info('  • Check AWS credentials are configured');
      logger.info('  • Verify infrastructure is deployed (terraform apply)');
      logger.info('  • Ensure S3 bucket exists and is accessible');
      logger.info('  • Run with --verbose for detailed logs');
      
      process.exit(1);
    }
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    // ============================================
    // 9. DISPLAY RESULTS
    // ============================================
    logger.info('');
    logger.header('Test Results');
    logger.info('');

    logger.info(`  Run ID:          ${chalk.cyan(result.runId)}`);
    logger.info(`  Backend:         ${chalk.cyan(result.backend)}`);
    logger.info(`  Duration:        ${logger.duration(totalDuration)}`);

    // Cost with optional comparison (single line)
    if (config.output.showCostComparison !== false) {
      const circleCICost = calculateCircleCICost(options.parallel, totalDuration);
      const savings = ((circleCICost - result.cost) / circleCICost * 100).toFixed(0);
      logger.info(
        `  Cost:            ${logger.cost(result.cost)} ` +
        chalk.gray(`(vs CircleCI: ${logger.cost(circleCICost)}, saved ${savings}%)`)
      );
    } else {
      logger.info(`  Cost:            ${logger.cost(result.cost)}`);
    }

    logger.info('');

    const totalTests = result.passed + result.failed + result.skipped;
    const passRate = totalTests > 0 
      ? ((result.passed / totalTests) * 100).toFixed(1)
      : '0';

    logger.info(`  Total Tests:     ${totalTests}`);

    if (result.passed > 0) {
      logger.success(`  Passed:          ${result.passed} (${passRate}%)`);
    }

    if (result.failed > 0) {
      logger.error(`  Failed:          ${result.failed}`);
    }

    if (result.skipped > 0) {
      logger.warn(`  Skipped:         ${result.skipped}`);
    }

    // ============================================
    // 10. VERBOSE MODE - DETAILED COST BREAKDOWN
    // ============================================
    if (options.verbose && config.output.showCostComparison !== false) {
      logger.info('');
      logger.section('Cost Breakdown', '');
      
      if (result.backend === 'ecs') {
        const hours = totalDuration / (1000 * 60 * 60);
        const cpuCost = (config.execution.cpu / 1024) * 0.04048 * options.parallel * hours;
        const memCost = (config.execution.memory / 1024) * 0.004445 * options.parallel * hours;
        
        logger.info('  ECS Fargate:');
        logger.info(`    • CPU:         ${options.parallel} tasks × ${config.execution.cpu / 1024} vCPU × ${(totalDuration / 60000).toFixed(2)} min = ${logger.cost(cpuCost)}`);
        logger.info(`    • Memory:      ${options.parallel} tasks × ${config.execution.memory / 1024} GB × ${(totalDuration / 60000).toFixed(2)} min = ${logger.cost(memCost)}`);
        logger.info(`    • Total:       ${logger.cost(result.cost)}`);
      } else if (result.backend === 'kubernetes') {
        const hours = totalDuration / (1000 * 60 * 60);
        const nodesNeeded = Math.ceil((options.parallel * config.execution.cpu) / (4 * 1024));
        const nodeCost = nodesNeeded * 0.0188 * hours;
        
        logger.info('  Kubernetes (EKS + EC2 Spot):');
        logger.info(`    • Nodes:       ${nodesNeeded} × t3a.large spot`);
        logger.info(`    • Duration:    ${(totalDuration / 60000).toFixed(2)} min`);
        logger.info(`    • Node cost:   ${logger.cost(nodeCost)}`);
        logger.info(`    • Total:       ${logger.cost(result.cost)}`);
        logger.info(chalk.gray(`    • EKS control plane: $72/month (not included above)`));
      }
      
      logger.info('');
      logger.info('  Comparison:');
      
      const circleCICost = calculateCircleCICost(options.parallel, totalDuration);
      const githubCost = calculateGitHubActionsCost(options.parallel, totalDuration);
      
      const circlePercent = ((circleCICost / result.cost - 1) * 100).toFixed(0);
      const githubPercent = ((githubCost / result.cost - 1) * 100).toFixed(0);
      
      logger.info(`    • CircleCI:    ${logger.cost(circleCICost)} (${circlePercent}% more expensive)`);
      logger.info(`    • GitHub:      ${logger.cost(githubCost)} (${githubPercent}% more expensive)`);
      logger.info(`    • Your savings: ${logger.cost(Math.max(circleCICost, githubCost) - result.cost)}`);
    }

    // ============================================
    // 11. PERFORMANCE METRICS (VERBOSE ONLY)
    // ============================================
    if (options.verbose) {
      logger.info('');
      logger.section('Performance Metrics', '');
      
      const avgTestDuration = totalDuration / totalTests;
      const testsPerSecond = (totalTests / (totalDuration / 1000)).toFixed(2);
      
      logger.info(`  Avg test duration:     ${(avgTestDuration / 1000).toFixed(2)}s`);
      logger.info(`  Tests per second:      ${testsPerSecond}`);
      logger.info(`  Parallelization:       ${options.parallel}x`);
      
      if (discovery.estimatedDuration) {
        const speedup = discovery.estimatedDuration / totalDuration;
        logger.info(`  Speedup vs serial:     ${speedup.toFixed(1)}x`);
      }
    }

    // ============================================
    // 12. NEXT STEPS & LINKS
    // ============================================
    logger.info('');
    logger.info('Next steps:');
    logger.info(`  • View detailed cost analysis: ${chalk.cyan(`cheaptest cost --last-run`)}`);
    logger.info(`  • Check run status: ${chalk.cyan(`cheaptest status ${result.runId}`)}`);

    if (result.failed > 0) {
      logger.info(`  • Retry only failed tests: ${chalk.cyan(`cheaptest run --tests ./e2e --only-failed ${result.runId}`)}`);
    }

    // ============================================
    // 12b. JUNIT XML EXPORT
    // ============================================
    if (options.junit) {
      try {
        const junitPath = await writeJunitXml(result, options.junit);
        logger.success(`JUnit XML report written to ${chalk.cyan(junitPath)}`);
      } catch (err: unknown) {
        logger.warn(`Failed to write JUnit XML: ${getErrorMessage(err)}`);
      }
    }

    logger.info('');

    // ============================================
    // 13. EXIT WITH APPROPRIATE CODE
    // ============================================
    if (result.failed > 0) {
      logger.error('Test run completed with failures');
      process.exit(1);
    } else {
      logger.success('All tests passed!');
      process.exit(0);
    }
    
  } catch (err: unknown) {
    logger.stopSpinner();
    logger.error(`Unexpected error: ${getErrorMessage(err)}`);

    if (options.verbose && err instanceof Error && err.stack) {
      logger.info('');
      logger.debug('Stack trace:');
      logger.debug(err.stack);
    }
    
    process.exit(1);
  }
}

/**
 * Calculate estimated cost for test run
 */
function calculateEstimatedCost(
  backend: 'ecs' | 'kubernetes',
  parallelism: number,
  cpu: number,
  memory: number,
  estimatedDurationMs: number
): number {
  const hours = estimatedDurationMs / (1000 * 60 * 60);
  
  if (backend === 'ecs') {
    // Fargate pricing (us-east-1)
    const cpuCost = (cpu / 1024) * 0.04048; // per vCPU-hour
    const memCost = (memory / 1024) * 0.004445; // per GB-hour
    const costPerTaskHour = cpuCost + memCost;
    
    return parallelism * costPerTaskHour * hours;
  } else {
    // EKS + EC2 spot pricing (approximate)
    // Assuming t3a.large spot at $0.0188/hour
    const nodesNeeded = Math.ceil((parallelism * cpu) / (4 * 1024)); // 4 vCPU per t3a.large
    const nodeCost = nodesNeeded * 0.0188 * hours;
    
    return nodeCost;
  }
}

/**
 * Calculate what CircleCI would cost for same workload
 */
function calculateCircleCICost(parallelism: number, durationMs: number): number {
  // CircleCI charges $0.006/minute per container
  const minutes = durationMs / (1000 * 60);
  const costPerMinute = 0.006;
  
  return parallelism * minutes * costPerMinute;
}

/**
 * Calculate GitHub Actions cost
 */
function calculateGitHubActionsCost(parallelism: number, durationMs: number): number {
  // GitHub Actions: $0.008 per minute
  const minutes = durationMs / (1000 * 60);
  const costPerMinute = 0.008;
  
  return parallelism * minutes * costPerMinute;
}