import chalk from 'chalk';
import ora, { Ora } from 'ora';

export class Logger {
  private verbose: boolean;
  private spinner: Ora | null = null;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  info(message: string): void {
    console.log(chalk.blue('ℹ'), message);
  }

  success(message: string): void {
    console.log(chalk.green('✓'), message);
  }

  error(message: string): void {
    console.error(chalk.red('✗'), message);
  }

  warn(message: string): void {
    console.warn(chalk.yellow('⚠'), message);
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(chalk.gray('→'), message);
    }
  }

  startSpinner(message: string): void {
    this.spinner = ora(message).start();
  }

  updateSpinner(message: string): void {
    if (this.spinner) {
      this.spinner.text = message;
    }
  }

  succeedSpinner(message?: string): void {
    if (this.spinner) {
      this.spinner.succeed(message);
      this.spinner = null;
    }
  }

  failSpinner(message?: string): void {
    if (this.spinner) {
      this.spinner.fail(message);
      this.spinner = null;
    }
  }

  stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  table(data: Record<string, any>[]): void {
    // We'll implement this with the 'table' package
    console.table(data);
  }

  header(message: string): void {
    console.log();
    console.log(chalk.bold.cyan(message));
    console.log(chalk.cyan('━'.repeat(message.length)));
  }

  section(title: string, content: string): void {
    console.log();
    console.log(chalk.bold(title));
    console.log(content);
  }

  cost(amount: number): string {
    return chalk.green(`$${amount.toFixed(4)}`);
  }

  duration(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return chalk.yellow(`${minutes}m ${seconds}s`);
  }
}

export const logger = new Logger();