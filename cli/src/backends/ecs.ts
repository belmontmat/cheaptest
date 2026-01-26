import { BackendInterface, RunOptions, CheaptestConfig, RunSummary, RunStatus } from '../types';
import { Logger } from '../utils/logger';

export class ECSBackend implements BackendInterface {
  constructor(private logger: Logger) {}

  async run(options: RunOptions, config: CheaptestConfig): Promise<RunSummary> {
    this.logger.info('ECS backend: Starting test execution...');
    
    // TODO: Implement ECS execution
    // 1. Discover tests
    // 2. Create shards
    // 3. Upload to S3
    // 4. Launch ECS tasks
    // 5. Monitor progress
    // 6. Aggregate results
    
    throw new Error('ECS backend not yet implemented');
  }

  async status(runId: string): Promise<RunStatus> {
    throw new Error('Status check not yet implemented');
  }

  async cancel(runId: string): Promise<void> {
    throw new Error('Cancel not yet implemented');
  }
}