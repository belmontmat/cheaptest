import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { RunnerConfig, TestCase } from '../runner';

export class PlaywrightRunner {
  private config: RunnerConfig;

  constructor(config: RunnerConfig) {
    this.config = config;
  }

  async execute(): Promise<TestCase[]> {
    console.log('Running Playwright tests...');

    // Create a temporary file list for this shard
    const testFiles = this.config.shard.files.map(f => f.relativePath);
    const fileListPath = path.join(this.config.workspace, '.shard-files.txt');
    await fs.writeFile(fileListPath, testFiles.join('\n'));

    // Create Playwright config for this shard
    const playwrightConfig = await this.createPlaywrightConfig(testFiles);
    const configPath = path.join(this.config.workspace, 'playwright.shard.config.ts');
    await fs.writeFile(configPath, playwrightConfig);

    // Run Playwright with JSON reporter
    const resultsPath = path.join(this.config.workspace, 'playwright-results.json');

    return new Promise((resolve, reject) => {
      const args = [
        'test',
        '--config', configPath,
        '--reporter', `json`,
        ...testFiles,
      ];

      console.log(`  Command: npx playwright ${args.join(' ')}`);

      const proc = spawn('npx', ['playwright', ...args], {
        cwd: this.config.workspace,
        env: {
          ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_NAME: resultsPath,
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
        reject(new Error(`Playwright tests timed out after ${this.config.timeout}ms`));
      }, this.config.timeout);

      proc.on('close', async (code) => {
        clearTimeout(timeout);

        try {
          // Parse Playwright JSON results
          const results = await this.parseResults(resultsPath);
          resolve(results);
        } catch (error) {
          // If parsing fails, try to extract info from stdout/stderr
          console.error('Failed to parse results:', error);
          const fallbackResults = this.parseFallbackResults(stdout, stderr, testFiles);
          resolve(fallbackResults);
        }
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Playwright: ${error.message}`));
      });
    });
  }

  private async createPlaywrightConfig(testFiles: string[]): Promise<string> {
    return `
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: ${this.config.timeout},
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'json',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
`;
  }

  private async parseResults(resultsPath: string): Promise<TestCase[]> {
    try {
      const content = await fs.readFile(resultsPath, 'utf-8');
      const data = JSON.parse(content);

      const tests: TestCase[] = [];

      if (data.suites) {
        for (const suite of data.suites) {
          this.extractTestsFromSuite(suite, tests);
        }
      }

      return tests;
    } catch (error) {
      throw new Error(`Failed to parse Playwright results: ${error}`);
    }
  }

  private extractTestsFromSuite(suite: any, tests: TestCase[]): void {
    // Process tests in this suite
    if (suite.specs) {
      for (const spec of suite.specs) {
        for (const test of spec.tests || []) {
          const result = test.results?.[0];
          
          tests.push({
            name: spec.title,
            file: suite.file || 'unknown',
            status: this.mapStatus(result?.status),
            duration: result?.duration || 0,
            error: result?.error?.message,
            stack: result?.error?.stack,
          });
        }
      }
    }

    // Recursively process child suites
    if (suite.suites) {
      for (const childSuite of suite.suites) {
        this.extractTestsFromSuite(childSuite, tests);
      }
    }
  }

  private mapStatus(status: string | undefined): 'passed' | 'failed' | 'skipped' {
    switch (status) {
      case 'passed':
        return 'passed';
      case 'failed':
      case 'timedOut':
        return 'failed';
      case 'skipped':
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
    // Fallback parsing from console output
    const tests: TestCase[] = [];

    // Try to extract test results from stdout
    const passedMatches = stdout.match(/(\d+) passed/);
    const failedMatches = stdout.match(/(\d+) failed/);

    const passed = passedMatches ? parseInt(passedMatches[1]) : 0;
    const failed = failedMatches ? parseInt(failedMatches[1]) : 0;

    // Create placeholder results
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