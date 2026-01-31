import { PlaywrightRunner } from './frameworks/playwright';
import { CypressRunner } from './frameworks/cypress';
import { SeleniumRunner } from './frameworks/selenium';

export interface TestShard {
  id: number;
  files: Array<{
    path: string;
    relativePath: string;
  }>;
}

export interface RunnerConfig {
  framework: 'playwright' | 'cypress' | 'selenium';
  workspace: string;
  timeout: number;
  shard: TestShard;
}

export interface TestResult {
  shard: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  tests: TestCase[];
}

export interface TestCase {
  name: string;
  file: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  stack?: string;
}

export class TestRunner {
  private config: RunnerConfig;

  constructor(config: RunnerConfig) {
    this.config = config;
  }

  async run(): Promise<TestResult> {
    const startTime = Date.now();

    let runner;
    switch (this.config.framework) {
      case 'playwright':
        runner = new PlaywrightRunner(this.config);
        break;
      case 'cypress':
        runner = new CypressRunner(this.config);
        break;
      case 'selenium':
        runner = new SeleniumRunner(this.config);
        break;
      default:
        throw new Error(`Unknown framework: ${this.config.framework}`);
    }

    const tests = await runner.execute();
    const duration = Date.now() - startTime;

    // Calculate statistics
    const passed = tests.filter(t => t.status === 'passed').length;
    const failed = tests.filter(t => t.status === 'failed').length;
    const skipped = tests.filter(t => t.status === 'skipped').length;

    return {
      shard: this.config.shard.id,
      passed,
      failed,
      skipped,
      duration,
      tests,
    };
  }
}