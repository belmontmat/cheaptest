"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.validateConfig = validateConfig;
exports.findConfigFile = findConfigFile;
const promises_1 = __importDefault(require("fs/promises"));
const yaml_1 = __importDefault(require("yaml"));
exports.DEFAULT_CONFIG = {
    version: 1,
    aws: {
        region: process.env.AWS_REGION || 'us-east-1',
        cluster: 'cheaptest-cluster',
        taskDefinition: 'cheaptest-runner',
        subnets: [],
        securityGroups: [],
    },
    tests: {
        directory: './e2e',
        pattern: '**/*.spec.ts',
        framework: 'playwright',
    },
    execution: {
        cpu: 1024,
        memory: 2048,
        timeout: 30,
    },
    storage: {
        bucket: 'cheaptest-storage',
        retentionDays: 30,
    },
    output: {
        format: 'pretty',
        verbose: false,
    },
};
async function loadConfig(configPath) {
    try {
        const content = await promises_1.default.readFile(configPath, 'utf-8');
        const config = yaml_1.default.parse(content);
        // Merge with defaults
        return {
            ...exports.DEFAULT_CONFIG,
            ...config,
            aws: { ...exports.DEFAULT_CONFIG.aws, ...config.aws },
            tests: { ...exports.DEFAULT_CONFIG.tests, ...config.tests },
            execution: { ...exports.DEFAULT_CONFIG.execution, ...config.execution },
            storage: { ...exports.DEFAULT_CONFIG.storage, ...config.storage },
            output: { ...exports.DEFAULT_CONFIG.output, ...config.output },
        };
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            throw new Error(`Config file not found: ${configPath}\nRun 'cheaptest init' to create one.`);
        }
        throw new Error(`Failed to load config: ${err.message}`);
    }
}
async function saveConfig(configPath, config, force = false) {
    const exists = await promises_1.default.access(configPath).then(() => true).catch(() => false);
    if (exists && !force) {
        throw new Error(`Config file already exists: ${configPath}\nUse --force to overwrite.`);
    }
    const content = yaml_1.default.stringify(config);
    await promises_1.default.writeFile(configPath, content, 'utf-8');
}
function validateConfig(config) {
    const errors = [];
    if (!config.aws.region) {
        errors.push('AWS region is required');
    }
    if (!config.aws.cluster) {
        errors.push('ECS cluster name is required');
    }
    if (!config.storage.bucket) {
        errors.push('S3 bucket is required');
    }
    if (config.execution.cpu < 256) {
        errors.push('CPU must be at least 256');
    }
    if (config.execution.memory < 512) {
        errors.push('Memory must be at least 512');
    }
    return errors;
}
async function findConfigFile() {
    const possiblePaths = [
        '.cheaptest.yml',
        '.cheaptest.yaml',
        'cheaptest.yml',
        'cheaptest.yaml',
    ];
    for (const p of possiblePaths) {
        try {
            await promises_1.default.access(p);
            return p;
        }
        catch {
            continue;
        }
    }
    return null;
}
//# sourceMappingURL=config.js.map