import { BackendInterface, RunOptions, CheaptestConfig, RunSummary, RunStatus } from '../types';
import { Logger } from '../utils/logger';

export class KubernetesBackend implements BackendInterface {
  constructor(_logger: Logger) {
    // Logger will be used when backend is implemented
  }

  async run(_options: RunOptions, _config: CheaptestConfig): Promise<RunSummary> {
    throw new Error('Kubernetes backend not implemented yet');
  }

  async status(_runId: string): Promise<RunStatus> {
    throw new Error('Status not implemented yet');
  }

  async cancel(_runId: string): Promise<void> {
    throw new Error('Cancel not implemented yet');
  }
}