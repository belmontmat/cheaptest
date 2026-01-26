import { Logger } from '../utils/logger';

interface StatusOptions {
  watch?: boolean;
}

export async function statusCommand(runId: string, options: StatusOptions): Promise<void> {
  const logger = new Logger();
  
  if (!runId) {
    logger.error('Run ID is required');
    process.exit(1);
  }
  
  logger.info(`Checking status of run: ${runId}`);
  
  // TODO: Implement status checking
  logger.warn('Status command not yet implemented');
}