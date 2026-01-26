"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusCommand = statusCommand;
const logger_1 = require("../utils/logger");
async function statusCommand(runId, options) {
    const logger = new logger_1.Logger();
    if (!runId) {
        logger.error('Run ID is required');
        process.exit(1);
    }
    logger.info(`Checking status of run: ${runId}`);
    // TODO: Implement status checking
    logger.warn('Status command not yet implemented');
}
//# sourceMappingURL=status.js.map