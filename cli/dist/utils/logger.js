"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.Logger = void 0;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
class Logger {
    verbose;
    spinner = null;
    constructor(verbose = false) {
        this.verbose = verbose;
    }
    info(message) {
        console.log(chalk_1.default.blue('ℹ'), message);
    }
    success(message) {
        console.log(chalk_1.default.green('✓'), message);
    }
    error(message) {
        console.error(chalk_1.default.red('✗'), message);
    }
    warn(message) {
        console.warn(chalk_1.default.yellow('⚠'), message);
    }
    debug(message) {
        if (this.verbose) {
            console.log(chalk_1.default.gray('→'), message);
        }
    }
    startSpinner(message) {
        this.spinner = (0, ora_1.default)(message).start();
    }
    updateSpinner(message) {
        if (this.spinner) {
            this.spinner.text = message;
        }
    }
    succeedSpinner(message) {
        if (this.spinner) {
            this.spinner.succeed(message);
            this.spinner = null;
        }
    }
    failSpinner(message) {
        if (this.spinner) {
            this.spinner.fail(message);
            this.spinner = null;
        }
    }
    stopSpinner() {
        if (this.spinner) {
            this.spinner.stop();
            this.spinner = null;
        }
    }
    table(data) {
        // We'll implement this with the 'table' package
        console.table(data);
    }
    header(message) {
        console.log();
        console.log(chalk_1.default.bold.cyan(message));
        console.log(chalk_1.default.cyan('━'.repeat(message.length)));
    }
    section(title, content) {
        console.log();
        console.log(chalk_1.default.bold(title));
        console.log(content);
    }
    cost(amount) {
        return chalk_1.default.green(`$${amount.toFixed(4)}`);
    }
    duration(ms) {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return chalk_1.default.yellow(`${minutes}m ${seconds}s`);
    }
}
exports.Logger = Logger;
exports.logger = new Logger();
//# sourceMappingURL=logger.js.map