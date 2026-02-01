import { BackendInterface, RunOptions, CheaptestConfig, RunSummary, RunStatus } from '../types';
import { Logger } from '../utils/logger';

export class KubernetesBackend implements BackendInterface {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async run(options: RunOptions, config: CheaptestConfig): Promise<RunSummary> {
    throw new Error('Kubernetes backend not implemented yet');
  }

  async status(runId: string): Promise<RunStatus> {
    throw new Error('Status not implemented yet');
  }

  async cancel(runId: string): Promise<void> {
    throw new Error('Cancel not implemented yet');
  }
}