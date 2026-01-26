interface CostOptions {
    lastRun?: boolean;
    last7Days?: boolean;
    last30Days?: boolean;
    breakdown?: boolean;
}
export declare function costCommand(options: CostOptions): Promise<void>;
export {};
//# sourceMappingURL=cost.d.ts.map