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

    // Find the actual test root directory
    // The tarball extracts with the parent directory name (e.g., /workspace/cypress/...)
    const testRoot = await this.findTestRoot();
    console.log(`  Test root directory: ${testRoot}`);

    const testFiles = this.config.shard.files.map(f => f.relativePath);

    // Create Cypress config (use .js to avoid TypeScript compilation)
    const cypressConfig = await this.createCypressConfig();
    const configPath = path.join(testRoot, 'cypress.shard.config.js');
    await fs.writeFile(configPath, cypressConfig);

    // Create tsconfig.json if it doesn't exist (needed for TypeScript test files)
    const tsconfigPath = path.join(testRoot, 'tsconfig.json');
    try {
      await fs.access(tsconfigPath);
    } catch {
      const tsconfig = {
        compilerOptions: {
          target: 'ES2020',
          lib: ['ES2020', 'DOM'],
          types: ['cypress'],
          moduleResolution: 'node',
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['**/*.ts'],
      };
      await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));
      console.log('  Created tsconfig.json for TypeScript support');
    }

    // Symlink node_modules from /app so Cypress can find TypeScript locally
    const nodeModulesLink = path.join(testRoot, 'node_modules');
    try {
      await fs.access(nodeModulesLink);
    } catch {
      await fs.symlink('/app/node_modules', nodeModulesLink);
      console.log('  Symlinked node_modules for TypeScript support');
    }

    // Cypress runs one spec at a time, so we'll run them sequentially
    const allTests: TestCase[] = [];

    for (const testFile of testFiles) {
      const tests = await this.runSpec(testFile, configPath, testRoot);
      allTests.push(...tests);
    }

    return allTests;
  }

  /**
   * Find the actual test root directory.
   * The tarball extracts with the parent directory name (e.g., /workspace/cypress/...)
   * so we need to find that subdirectory.
   */
  private async findTestRoot(): Promise<string> {
    const entries = await fs.readdir(this.config.workspace, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

    // If there's exactly one directory and it looks like our test directory, use it
    if (dirs.length === 1) {
      const subdir = path.join(this.config.workspace, dirs[0].name);
      console.log(`  Found single subdirectory: ${dirs[0].name}`);
      return subdir;
    }

    // Otherwise, use the workspace directly
    return this.config.workspace;
  }

  private async runSpec(specFile: string, configPath: string, testRoot: string): Promise<TestCase[]> {
    console.log(`  Running: ${specFile}`);

    const resultsPath = path.join(
      testRoot,
      'cypress',
      'results',
      `${path.basename(specFile, path.extname(specFile))}.json`
    );

    // Ensure results directory exists
    await fs.mkdir(path.dirname(resultsPath), { recursive: true });

    // Use the installed Cypress from /app/node_modules instead of npx
    const cypressBin = '/app/node_modules/.bin/cypress';

    // Use absolute path for spec file (relative to testRoot)
    const absoluteSpecPath = path.join(testRoot, specFile);

    return new Promise((resolve, reject) => {
      const args = [
        'run',
        '--config-file', configPath,
        '--spec', absoluteSpecPath,
        '--reporter', 'json',
        '--reporter-options', `output=${resultsPath}`,
        '--headless',
      ];

      console.log(`    Command: ${cypressBin} ${args.join(' ')}`);

      const proc = spawn(cypressBin, args, {
        cwd: testRoot,
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

      proc.on('close', (code) => {
        clearTimeout(timeout);

        (async () => {
          try {
            const results = await this.parseResults(resultsPath, specFile);
            resolve(results);
          } catch (error) {
            console.error(`Failed to parse results for ${specFile}:`, error);
            const fallbackResults = this.parseFallbackResults(stdout, stderr, specFile);
            resolve(fallbackResults);
          }
        })().catch(reject);
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn Cypress: ${error.message}`));
      });
    });
  }

  private async createCypressConfig(): Promise<string> {
    // Use CommonJS module.exports to avoid needing Cypress import in workspace
    // No baseUrl - tests should use full URLs or cy.visit() with full paths
    return `
module.exports = {
  e2e: {
    supportFile: false,
    video: false,
    screenshotOnRunFailure: false,
    defaultCommandTimeout: 10000,
    specPattern: '**/*.cy.{js,ts}',
  },
  retries: {
    runMode: 0,
    openMode: 0,
  },
};
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

    // First, try to parse JSON from stdout (Cypress JSON reporter outputs to stdout)
    try {
      // Find JSON object in stdout (starts with { and ends with })
      const jsonMatch = stdout.match(/\{[\s\S]*"stats"[\s\S]*"tests"[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);

        // Parse the tests array directly (JSON reporter format)
        if (data.tests && Array.isArray(data.tests)) {
          for (const test of data.tests) {
            const hasError = test.err && Object.keys(test.err).length > 0;
            tests.push({
              name: test.title || test.fullTitle,
              file: specFile,
              status: hasError ? 'failed' : 'passed',
              duration: test.duration || 0,
              error: test.err?.message,
              stack: test.err?.stack,
            });
          }
          console.log(`  Parsed ${tests.length} tests from stdout JSON`);
          return tests;
        }
      }
    } catch (e) {
      console.log(`  Could not parse JSON from stdout: ${e}`);
    }

    // Fallback: Try to extract basic pass/fail info from text output
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