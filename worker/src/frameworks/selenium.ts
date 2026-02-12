import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { RunnerConfig, TestCase } from '../runner';

export class SeleniumRunner {
  private config: RunnerConfig;

  constructor(config: RunnerConfig) {
    this.config = config;
  }

  async execute(): Promise<TestCase[]> {
    console.log('Running Selenium tests with Jest...');

    // Find the actual test root directory
    // The tarball extracts with the parent directory name (e.g., /workspace/selenium/...)
    const testRoot = await this.findTestRoot();
    console.log(`  Test root directory: ${testRoot}`);

    const testFiles = this.config.shard.files.map(f => f.relativePath);

    // Create Jest config for Selenium tests
    const jestConfig = await this.createJestConfig();
    const configPath = path.join(testRoot, 'jest.shard.config.js');
    await fs.writeFile(configPath, jestConfig);

    // Run Jest with JSON reporter
    const resultsPath = path.join(testRoot, 'selenium-results.json');

    // Symlink node_modules from /app if not present
    const nodeModulesLink = path.join(testRoot, 'node_modules');
    try {
      await fs.access(nodeModulesLink);
    } catch {
      await fs.symlink('/app/node_modules', nodeModulesLink);
      console.log('  Symlinked node_modules for dependencies');
    }

    // Use the installed Jest from /app/node_modules instead of npx
    const jestBin = '/app/node_modules/.bin/jest';

    return new Promise((resolve, reject) => {
      const args = [
        '--config', configPath,
        '--json',
        '--outputFile', resultsPath,
        '--testTimeout', this.config.timeout.toString(),
        '--runInBand', // Run tests serially
        ...testFiles,
      ];

      console.log(`  Command: ${jestBin} ${args.join(' ')}`);

      const proc = spawn(jestBin, args, {
        cwd: testRoot,
        env: {
          ...process.env,
          NODE_ENV: 'test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        process.stdout.write(output);
      });

      proc.stderr?.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        process.stderr.write(output);
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Selenium tests timed out after ${this.config.timeout}ms`));
      }, this.config.timeout);

      proc.on('close', (code) => {
        clearTimeout(timeout);

        (async () => {
          try {
            const results = await this.parseResults(resultsPath);
            resolve(results);
          } catch (error) {
            console.error('Failed to parse results:', error);
            const fallbackResults = this.parseFallbackResults(stdout, stderr, testFiles);
            resolve(fallbackResults);
          }
        })().catch(reject);
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Jest: ${error.message}`));
      });
    });
  }

  /**
   * Find the actual test root directory.
   * The tarball extracts with the parent directory name (e.g., /workspace/selenium/...)
   * so we need to find that subdirectory.
   */
  private async findTestRoot(): Promise<string> {
    const entries = await fs.readdir(this.config.workspace, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

    // If there's exactly one directory, use it as the test root
    if (dirs.length === 1) {
      const subdir = path.join(this.config.workspace, dirs[0].name);
      console.log(`  Found single subdirectory: ${dirs[0].name}`);
      return subdir;
    }

    // Otherwise, use the workspace directly
    return this.config.workspace;
  }

  private async createJestConfig(): Promise<string> {
    // Use ts-jest from /app/node_modules to avoid needing it in workspace
    return `
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.tsx?$': '/app/node_modules/ts-jest',
  },
  collectCoverage: false,
  verbose: true,
  testTimeout: ${this.config.timeout},
};
`;
  }

  private async parseResults(resultsPath: string): Promise<TestCase[]> {
    try {
      const content = await fs.readFile(resultsPath, 'utf-8');
      const data = JSON.parse(content);

      const tests: TestCase[] = [];

      if (data.testResults) {
        for (const fileResult of data.testResults) {
          for (const assertionResult of fileResult.assertionResults || []) {
            tests.push({
              name: assertionResult.fullName || assertionResult.title,
              file: fileResult.name,
              status: this.mapStatus(assertionResult.status),
              duration: assertionResult.duration || 0,
              error: assertionResult.failureMessages?.join('\n'),
              stack: assertionResult.failureMessages?.join('\n'),
            });
          }
        }
      }

      return tests;
    } catch (error) {
      throw new Error(`Failed to parse Jest results: ${error}`);
    }
  }

  private mapStatus(status: string | undefined): 'passed' | 'failed' | 'skipped' {
    switch (status) {
      case 'passed':
        return 'passed';
      case 'failed':
        return 'failed';
      case 'pending':
      case 'skipped':
      case 'todo':
        return 'skipped';
      default:
        return 'skipped';
    }
  }

  private parseFallbackResults(
    stdout: string,
    stderr: string,
    testFiles: string[]
  ): TestCase[] {
    const tests: TestCase[] = [];

    // Try to extract test results from stdout
    const passedMatches = stdout.match(/(\d+) passed/);
    const failedMatches = stdout.match(/(\d+) failed/);

    const passed = passedMatches ? parseInt(passedMatches[1]) : 0;
    const failed = failedMatches ? parseInt(failedMatches[1]) : 0;

    for (let i = 0; i < passed; i++) {
      tests.push({
        name: `Test ${i + 1}`,
        file: testFiles[0] || 'unknown',
        status: 'passed',
        duration: 0,
      });
    }

    for (let i = 0; i < failed; i++) {
      tests.push({
        name: `Test ${i + 1}`,
        file: testFiles[0] || 'unknown',
        status: 'failed',
        duration: 0,
        error: 'Test failed (details not available)',
      });
    }

    return tests;
  }
}