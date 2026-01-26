import path from 'path';
import chalk from 'chalk';
import { Logger } from '../utils/logger';
import { saveConfig, DEFAULT_CONFIG } from '../utils/config';
import { CheaptestConfig } from '../types';

interface InitOptions {
  force?: boolean;
  backend?: 'ecs' | 'kubernetes';
}

export async function initCommand(options: InitOptions): Promise<void> {
  const logger = new Logger();
  
  try {
    logger.header('Initializing cheaptest configuration');
    
    const configPath = path.join(process.cwd(), '.cheaptest.yml');
    
    // Create config with user's choices
    const config: CheaptestConfig = {
      ...DEFAULT_CONFIG,
    };
    
    // Add K8s config if backend is kubernetes
    if (options.backend === 'kubernetes') {
      config.kubernetes = {
        context: 'default',
        namespace: 'default',
      };
    }
    
    logger.startSpinner('Creating configuration file...');
    
    await saveConfig(configPath, config, options.force);
    
    logger.succeedSpinner(`Created ${chalk.cyan('.cheaptest.yml')}`);
    
    // Show next steps
    logger.info('');
    logger.info('Next steps:');
    logger.info('  1. Update AWS settings in .cheaptest.yml');
    logger.info('  2. Set up infrastructure:');
    logger.info(`     ${chalk.cyan('cd terraform/phase1 && terraform init && terraform apply')}`);
    logger.info('  3. Run your first test:');
    logger.info(`     ${chalk.cyan('cheaptest run --tests ./e2e --parallel 10')}`);
    
  } catch (err: any) {
    logger.error(`Failed to initialize: ${err.message}`);
    process.exit(1);
  }
}