"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initCommand = initCommand;
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const logger_1 = require("../utils/logger");
const config_1 = require("../utils/config");
async function initCommand(options) {
    const logger = new logger_1.Logger();
    try {
        logger.header('Initializing cheaptest configuration');
        const configPath = path_1.default.join(process.cwd(), '.cheaptest.yml');
        // Create config with user's choices
        const config = {
            ...config_1.DEFAULT_CONFIG,
        };
        // Add K8s config if backend is kubernetes
        if (options.backend === 'kubernetes') {
            config.kubernetes = {
                context: 'default',
                namespace: 'default',
            };
        }
        logger.startSpinner('Creating configuration file...');
        await (0, config_1.saveConfig)(configPath, config, options.force);
        logger.succeedSpinner(`Created ${chalk_1.default.cyan('.cheaptest.yml')}`);
        // Show next steps
        logger.info('');
        logger.info('Next steps:');
        logger.info('  1. Update AWS settings in .cheaptest.yml');
        logger.info('  2. Set up infrastructure:');
        logger.info(`     ${chalk_1.default.cyan('cd terraform/phase1 && terraform init && terraform apply')}`);
        logger.info('  3. Run your first test:');
        logger.info(`     ${chalk_1.default.cyan('cheaptest run --tests ./e2e --parallel 10')}`);
    }
    catch (err) {
        logger.error(`Failed to initialize: ${err.message}`);
        process.exit(1);
    }
}
//# sourceMappingURL=init.js.map