interface InitOptions {
    force?: boolean;
    backend?: 'ecs' | 'kubernetes';
}
export declare function initCommand(options: InitOptions): Promise<void>;
export {};
//# sourceMappingURL=init.d.ts.map