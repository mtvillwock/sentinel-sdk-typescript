export interface SentinelConfig {
    apiKey: string;
    endpoint?: string;
    source?: string;
    async?: boolean;
    enabled?: boolean;
    timeout?: number;
}
export interface TrackOptions {
    model: string;
    budget_cents?: number;
    provider?: string;
    source?: string;
    tier?: string;
    workflow_key?: string;
    metadata?: Record<string, any>;
    enforce_mode?: 'reject' | 'warn';
    estimated_cost_cents?: number;
    request_id?: string;
    attempt_number?: number;
}
export interface SentinelEvent {
    status: 'completed' | 'completed_over_budget' | 'rejected' | 'failed';
    source?: string;
    model: string;
    provider: string;
    budget_cents?: number;
    duration_ms: number;
    metadata?: Record<string, any>;
    input_tokens?: number;
    output_tokens?: number;
    estimated_cost_cents?: number;
    actual_cost_cents?: number;
    failure_reason?: string;
    enforce_mode?: string;
    request_id?: string;
    attempt_number?: number;
}
export interface SentinelResponse {
    id: string;
    status: string;
}
export declare class SentinelError extends Error {
    readonly code: string;
    readonly details?: any | undefined;
    constructor(message: string, code: string, details?: any | undefined);
}
export declare class BudgetExceededError extends SentinelError {
    constructor(message: string, details?: any);
}
export declare class Sentinel {
    private config;
    private static readonly DEFAULT_ENDPOINT;
    private static readonly SDK_VERSION;
    constructor(config: SentinelConfig);
    track<T>(fn: () => Promise<T>, opts: TrackOptions): Promise<T>;
    private generateRequestId;
    configure(config: Partial<SentinelConfig>): void;
    getConfig(): Readonly<Required<SentinelConfig>>;
    private executeAndTrack;
    private determineStatus;
    private calculateCost;
    private extractTokens;
    private buildMetadata;
    private sendEvent;
    private sendEventSync;
}
export declare function createSentinel(config: SentinelConfig): Sentinel;
export declare function estimateTokens(text: string): number;
export default Sentinel;
//# sourceMappingURL=index.d.ts.map