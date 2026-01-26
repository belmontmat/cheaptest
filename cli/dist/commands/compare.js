"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareCommand = compareCommand;
const logger_1 = require("../utils/logger");
async function compareCommand(options) {
    const logger = new logger_1.Logger();
    logger.header('Backend Comparison');
    // TODO: Run tests on both backends and compare
    logger.warn('Compare command not yet implemented');
}
//# sourceMappingURL=compare.js.map