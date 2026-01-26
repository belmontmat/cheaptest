#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { runCommand } from './commands/run';
import { initCommand } from './commands/init';
import { statusCommand } from './commands/status';
import { costCommand } from './commands/cost';
import { compareCommand } from './commands/compare';
import { version } from '../package.json';

const program = new Command();

program
  .name('cheaptest')
  .description('Cost-effective parallel e2e test runner')
  .version(version);

// Main command: run tests
program
  .command('run')
  .description('Run e2e tests in parallel')
  .option('-t, --tests <path>', 'Path to test directory', './e2e')
  .option('-p, --parallel <number>', 'Number of parallel workers', '10')
  .option('-b, --backend <type>', 'Backend to use (ecs|kubernetes)', 'ecs')
  .option('-c, --config <path>', 'Path to config file', '.cheaptest.yml')
  .option('-v, --verbose', 'Verbose output', false)
  .option('--dry-run', 'Show execution plan without running', false)
  .option('--timeout <minutes>', 'Test timeout in minutes', '30')
  .option('--retries <number>', 'Number of retries for failed tests', '0')
  .action(runCommand);

// Initialize configuration
program
  .command('init')
  .description('Initialize cheaptest configuration')
  .option('-f, --force', 'Overwrite existing config', false)
  .option('-b, --backend <type>', 'Default backend (ecs|kubernetes)', 'ecs')
  .action(initCommand);

// Check run status
program
  .command('status [runId]')
  .description('Check status of a test run')
  .option('-w, --watch', 'Watch status in real-time', false)
  .action(statusCommand);

// Cost analysis
program
  .command('cost')
  .description('Analyze test execution costs')
  .option('--last-run', 'Show cost of last run', false)
  .option('--last-7-days', 'Show costs from last 7 days', false)
  .option('--last-30-days', 'Show costs from last 30 days', false)
  .option('--breakdown', 'Show detailed cost breakdown', false)
  .action(costCommand);

// Compare backends
program
  .command('compare-backends')
  .description('Compare ECS vs Kubernetes performance and costs')
  .option('-t, --tests <path>', 'Path to test directory', './e2e')
  .option('-p, --parallel <number>', 'Number of parallel workers', '10')
  .action(compareCommand);

// Error handling
program.exitOverride();

try {
  program.parse(process.argv);
} catch (err: any) {
  if (err.code === 'commander.helpDisplayed') {
    process.exit(0);
  }
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
}

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}