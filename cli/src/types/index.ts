export type BackendType = 'ecs' | 'kubernetes';
export type OutputFormat = 'pretty' | 'json' | 'junit';
export type TestFramework = 'playwright' | 'cypress' | 'selenium';
import { TestFile } from '../core/test-parser';

export interface CheaptestConfig {
  version: number;
  aws: {
    region: string;
    cluster: string;
    taskDefinition: string;
    subnets: string[];
    securityGroups: string[];
  };
  tests: {
    directory: string;
    pattern: string;
    framework: TestFramework;
  };
  execution: {
    cpu: number;
    memory: number;
    timeout: number;
  };
  storage: {
    bucket: string;
    retentionDays: number;
  };
  output: {
    format: OutputFormat;
    verbose: boolean;
    showCostComparison?: boolean;
  };
  kubernetes?: {
    context?: string;
    namespace?: string;
  };
}

export interface RunOptions {
  tests: string;
  parallel: number;
  backend: BackendType;
  config?: string;
  verbose?: boolean;
  dryRun?: boolean;
  timeout?: number;
  retries?: number;
  testFiles?: TestFile[];
}

export interface TestShard {
  id: number;
  files: string[];
  estimatedDuration?: number;
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
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
}

export interface RunSummary {
  runId: string;
  backend: BackendType;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  cost: number;
  startTime: Date;
  endTime: Date;
}

export interface BackendInterface {
  run(options: RunOptions, config: CheaptestConfig): Promise<RunSummary>;
  status(runId: string): Promise<RunStatus>;
  cancel(runId: string): Promise<void>;
}

export interface RunStatus {
  runId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: {
    total: number;
    completed: number;
    running: number;
    failed: number;
  };
  startTime: Date;
  endTime?: Date;
}