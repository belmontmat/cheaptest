import fs from 'fs/promises';
import yaml from 'yaml';
import { CheaptestConfig } from '../types';

export const DEFAULT_CONFIG: CheaptestConfig = {
  version: 1,
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    cluster: 'cheaptest-cluster',
    taskDefinition: 'cheaptest-runner',
    subnets: [],
    securityGroups: [],
  },
  tests: {
    directory: './e2e',
    pattern: '',  // Empty to use framework-specific defaults
    framework: 'playwright',
  },
  execution: {
    cpu: 1024,
    memory: 2048,
    timeout: 30,
  },
  storage: {
    bucket: 'cheaptest-storage',
    retentionDays: 30,
  },
  output: {
    format: 'pretty',
    verbose: false,
  },
};

export async function loadConfig(configPath: string): Promise<CheaptestConfig> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = yaml.parse(content) as CheaptestConfig;
    
    // Merge with defaults
    return {
      ...DEFAULT_CONFIG,
      ...config,
      aws: { ...DEFAULT_CONFIG.aws, ...config.aws },
      tests: { ...DEFAULT_CONFIG.tests, ...config.tests },
      execution: { ...DEFAULT_CONFIG.execution, ...config.execution },
      storage: { ...DEFAULT_CONFIG.storage, ...config.storage },
      output: { ...DEFAULT_CONFIG.output, ...config.output },
    };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Config file not found: ${configPath}\nRun 'cheaptest init' to create one.`
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load config: ${message}`);
  }
}

export async function saveConfig(
  configPath: string,
  config: CheaptestConfig,
  force = false
): Promise<void> {
  const exists = await fs.access(configPath).then(() => true).catch(() => false);
  
  if (exists && !force) {
    throw new Error(
      `Config file already exists: ${configPath}\nUse --force to overwrite.`
    );
  }
  
  const content = yaml.stringify(config);
  await fs.writeFile(configPath, content, 'utf-8');
}

export function validateConfig(config: CheaptestConfig): string[] {
  const errors: string[] = [];
  
  if (!config.aws.region) {
    errors.push('AWS region is required');
  }
  
  if (!config.aws.cluster) {
    errors.push('ECS cluster name is required');
  }
  
  if (!config.storage.bucket) {
    errors.push('S3 bucket is required');
  }
  
  if (config.execution.cpu < 256) {
    errors.push('CPU must be at least 256');
  }
  
  if (config.execution.memory < 512) {
    errors.push('Memory must be at least 512');
  }
  
  return errors;
}

export async function findConfigFile(): Promise<string | null> {
  const possiblePaths = [
    '.cheaptest.yml',
    '.cheaptest.yaml',
    'cheaptest.yml',
    'cheaptest.yaml',
  ];
  
  for (const p of possiblePaths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      continue;
    }
  }
  
  return null;
}