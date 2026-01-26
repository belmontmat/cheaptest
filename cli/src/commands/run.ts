import path from 'path';
import { RunOptions, CheaptestConfig } from '../types';
import { Logger } from '../utils/logger';
import { loadConfig, validateConfig, findConfigFile } from '../utils/config';
import { ECSBackend } from '../backends/ecs';
import { KubernetesBackend } from '../backends/kubernetes';

export async function runCommand(options: RunOptions): Promise<void> {
  const logger = new Logger(options.verbose);
  
  try {
    logger.header('cheaptest - Parallel E2E Test Runner');
    
    // Load configuration
    logger.startSpinner('Loading configuration...');
    const configPath = options.config || await findConfigFile() || '.cheaptest.yml';
    const config = await loadConfig(configPath);
    logger.succeedSpinner(`Loaded config from ${configPath}`);
    
    // Validate configuration
    const errors = validateConfig(config);
    if (errors.length > 0) {
      logger.error('Configuration errors:');
      errors.forEach(err => logger.error(`  • ${err}`));
      process.exit(1);
    }
    
    // Show execution plan
    logger.info('');
    logger.section('Execution Plan', '');
    logger.info(`  Backend:      ${options.backend}`);
    logger.info(`  Tests:        ${options.tests}`);
    logger.info(`  Parallelism:  ${options.parallel}`);
    logger.info(`  Framework:    ${config.tests.framework}`);
    logger.info(`  Timeout:      ${options.timeout || config.execution.timeout} minutes`);
    
    if (options.dryRun) {
      logger.warn('Dry run mode - not executing tests');
      return;
    }
    
    // Select backend
    logger.info('');
    logger.startSpinner(`Initializing ${options.backend} backend...`);
    
    const backend = options.backend === 'kubernetes'
      ? new KubernetesBackend(logger)
      : new ECSBackend(logger);
    
    logger.succeedSpinner(`${options.backend} backend ready`);
    
    // Run tests
    logger.info('');
    const result = await backend.run(options, config);
    
    // Display results
    logger.info('');
    logger.header('Test Results');
    
    logger.info(`Run ID:       ${result.runId}`);
    logger.info(`Backend:      ${result.backend}`);
    logger.info(`Duration:     ${logger.duration(result.duration)}`);
    logger.info(`Cost:         ${logger.cost(result.cost)}`);
    logger.info('');
    
    const totalTests = result.passed + result.failed + result.skipped;
    logger.info(`Total tests:  ${totalTests}`);
    logger.success(`Passed:       ${result.passed}`);
    if (result.failed > 0) {
      logger.error(`Failed:       ${result.failed}`);
    }
    if (result.skipped > 0) {
      logger.warn(`Skipped:      ${result.skipped}`);
    }
    
    // Exit with appropriate code
    process.exit(result.failed > 0 ? 1 : 0);
    
  } catch (err: any) {
    logger.error(`Run failed: ${err.message}`);
    if (options.verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}