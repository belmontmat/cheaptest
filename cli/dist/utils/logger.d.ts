export declare class Logger {
    private verbose;
    private spinner;
    constructor(verbose?: boolean);
    info(message: string): void;
    success(message: string): void;
    error(message: string): void;
    warn(message: string): void;
    debug(message: string): void;
    startSpinner(message: string): void;
    updateSpinner(message: string): void;
    succeedSpinner(message?: string): void;
    failSpinner(message?: string): void;
    stopSpinner(): void;
    table(data: Record<string, any>[]): void;
    header(message: string): void;
    section(title: string, content: string): void;
    cost(amount: number): string;
    duration(ms: number): string;
}
export declare const logger: Logger;
//# sourceMappingURL=logger.d.ts.map