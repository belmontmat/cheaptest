import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { RunnerConfig, TestCase } from '../runner';

export class CypressRunner {
  private config: RunnerConfig;

  constructor(config: RunnerConfig) {
    this.config = config;
  }

  async execute(): Promise<TestCase[]> {
    console.log('Running Cypress tests...');

    const testFiles = this.config.shard.files.map(f => f.relativePath);

    // Create Cypress config
    const cypressConfig = await this.createCypressConfig();
    const configPath = path.join(this.config.workspace, 'cypress.shard.config.ts');
    await fs.writeFile(configPath, cypressConfig);

    // Cypress runs one spec at a time, so we'll run them sequentially
    const allTests: TestCase[] = [];

    for (const testFile of testFiles) {
      const tests = await this.runSpec(testFile, configPath);
      allTests.push(...tests);
    }

    return allTests;
  }

  private async runSpec(specFile: string, configPath: string): Promise<TestCase[]> {
    console.log(`  Running: ${specFile}`);

    const resultsPath = path.join(
      this.config.workspace,
      'cypress',
      'results',
      `${path.basename(specFile, path.extname(specFile))}.json`
    );

    // Ensure results directory exists
    await fs.mkdir(path.dirname(resultsPath), { recursive: true });

    return new Promise((resolve, reject) => {
      const args = [
        'run',
        '--config-file', configPath,
        '--spec', specFile,
        '--reporter', 'json',
        '--reporter-options', `output=${resultsPath}`,
        '--headless',
      ];

      console.log(`    Command: npx cypress ${args.join(' ')}`);

      const proc = spawn('npx', ['cypress', ...args], {
        cwd: this.config.workspace,
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
        reject(new Error(`Cypress spec ${specFile} timed out`));
      }, this.config.timeout);

      proc.on('close', async (code) => {
        clearTimeout(timeout);

        try {
          const results = await this.parseResults(resultsPath, specFile);
          resolve(results);
        } catch (error) {
          console.error(`Failed to parse results for ${specFile}:`, error);
          const fallbackResults = this.parseFallbackResults(stdout, stderr, specFile);
          resolve(fallbackResults);
        }
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Cypress: ${error.message}`));
      });
    });
  }

  private async createCypressConfig(): Promise<string> {
    return `
import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    supportFile: false,
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 10000,
  },
  retries: {
    runMode: 0,
    openMode: 0,
  },
});
`;
  }

  private async parseResults(resultsPath: string, specFile: string): Promise<TestCase[]> {
    try {
      const content = await fs.readFile(resultsPath, 'utf-8');
      const data = JSON.parse(content);

      const tests: TestCase[] = [];

      if (data.results) {
        for (const result of data.results) {
          if (result.suites) {
            for (const suite of result.suites) {
              this.extractTestsFromSuite(suite, tests, specFile);
            }
          }
        }
      }

      return tests;
    } catch (error) {
      throw new Error(`Failed to parse Cypress results: ${error}`);
    }
  }

  private extractTestsFromSuite(suite: any, tests: TestCase[], file: string): void {
    if (suite.tests) {
      for (const test of suite.tests) {
        tests.push({
          name: test.title,
          file,
          status: this.mapStatus(test.state),
          duration: test.duration || 0,
          error: test.err?.message,
          stack: test.err?.stack,
        });
      }
    }

    // Recursively process child suites
    if (suite.suites) {
      for (const childSuite of suite.suites) {
        this.extractTestsFromSuite(childSuite, tests, file);
      }
    }
  }

  private mapStatus(state: string | undefined): 'passed' | 'failed' | 'skipped' {
    switch (state) {
      case 'passed':
        return 'passed';
      case 'failed':
        return 'failed';
      case 'pending':
      case 'skipped':
        return 'skipped';
      default:
        return 'skipped';
    }
  }

  private parseFallbackResults(
    stdout: string,
    stderr: string,
    specFile: string
  ): TestCase[] {
    const tests: TestCase[] = [];

    // Try to extract basic pass/fail info
    const passedMatches = stdout.match(/(\d+) passing/);
    const failedMatches = stdout.match(/(\d+) failing/);

    const passed = passedMatches ? parseInt(passedMatches[1]) : 0;
    const failed = failedMatches ? parseInt(failedMatches[1]) : 0;

    for (let i = 0; i < passed; i++) {
      tests.push({
        name: `Test ${i + 1}`,
        file: specFile,
        status: 'passed',
        duration: 0,
      });
    }

    for (let i = 0; i < failed; i++) {
      tests.push({
        name: `Test ${i + 1}`,
        file: specFile,
        status: 'failed',
        duration: 0,
        error: 'Test failed (details not available)',
      });
    }

    return tests;
  }
}