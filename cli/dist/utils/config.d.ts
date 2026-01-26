import { CheaptestConfig } from '../types';
export declare const DEFAULT_CONFIG: CheaptestConfig;
export declare function loadConfig(configPath: string): Promise<CheaptestConfig>;
export declare function saveConfig(configPath: string, config: CheaptestConfig, force?: boolean): Promise<void>;
export declare function validateConfig(config: CheaptestConfig): string[];
export declare function findConfigFile(): Promise<string | null>;
//# sourceMappingURL=config.d.ts.map