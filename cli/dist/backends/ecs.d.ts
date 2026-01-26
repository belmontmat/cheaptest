import { BackendInterface, RunOptions, CheaptestConfig, RunSummary, RunStatus } from '../types';
import { Logger } from '../utils/logger';
export declare class ECSBackend implements BackendInterface {
    private logger;
    constructor(logger: Logger);
    run(options: RunOptions, config: CheaptestConfig): Promise<RunSummary>;
    status(runId: string): Promise<RunStatus>;
    cancel(runId: string): Promise<void>;
}
//# sourceMappingURL=ecs.d.ts.map