"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ECSBackend = void 0;
class ECSBackend {
    logger;
    constructor(logger) {
        this.logger = logger;
    }
    async run(options, config) {
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
    async status(runId) {
        throw new Error('Status check not yet implemented');
    }
    async cancel(runId) {
        throw new Error('Cancel not yet implemented');
    }
}
exports.ECSBackend = ECSBackend;
//# sourceMappingURL=ecs.js.map