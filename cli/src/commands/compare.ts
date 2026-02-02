import { Logger } from '../utils/logger';

interface CompareOptions {
  tests: string;
  parallel: number;
}

export async function compareCommand(_options: CompareOptions): Promise<void> {
  const logger = new Logger();
  
  logger.header('Backend Comparison');
  
  // TODO: Run tests on both backends and compare
  logger.warn('Compare command not yet implemented');
}