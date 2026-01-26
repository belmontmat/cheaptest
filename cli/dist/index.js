#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const run_1 = require("./commands/run");
const init_1 = require("./commands/init");
const status_1 = require("./commands/status");
const cost_1 = require("./commands/cost");
const compare_1 = require("./commands/compare");
const package_json_1 = require("../package.json");
const program = new commander_1.Command();
program
    .name('cheaptest')
    .description('Cost-effective parallel e2e test runner')
    .version(package_json_1.version);
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
    .action(run_1.runCommand);
// Initialize configuration
program
    .command('init')
    .description('Initialize cheaptest configuration')
    .option('-f, --force', 'Overwrite existing config', false)
    .option('-b, --backend <type>', 'Default backend (ecs|kubernetes)', 'ecs')
    .action(init_1.initCommand);
// Check run status
program
    .command('status [runId]')
    .description('Check status of a test run')
    .option('-w, --watch', 'Watch status in real-time', false)
    .action(status_1.statusCommand);
// Cost analysis
program
    .command('cost')
    .description('Analyze test execution costs')
    .option('--last-run', 'Show cost of last run', false)
    .option('--last-7-days', 'Show costs from last 7 days', false)
    .option('--last-30-days', 'Show costs from last 30 days', false)
    .option('--breakdown', 'Show detailed cost breakdown', false)
    .action(cost_1.costCommand);
// Compare backends
program
    .command('compare-backends')
    .description('Compare ECS vs Kubernetes performance and costs')
    .option('-t, --tests <path>', 'Path to test directory', './e2e')
    .option('-p, --parallel <number>', 'Number of parallel workers', '10')
    .action(compare_1.compareCommand);
// Error handling
program.exitOverride();
try {
    program.parse(process.argv);
}
catch (err) {
    if (err.code === 'commander.helpDisplayed') {
        process.exit(0);
    }
    console.error(chalk_1.default.red('Error:'), err.message);
    process.exit(1);
}
// Show help if no command provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
//# sourceMappingURL=index.js.map