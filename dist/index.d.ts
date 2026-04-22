/**
 * Sentinel SDK for Node.js/TypeScript
 *
 * Cost-aware execution runtime for LLM workflows.
 * Tracks spend, enforces budgets, and sends telemetry to your Sentinel dashboard.
 *
 * @packageDocumentation
 */
export interface SentinelConfig {
    /** Sentinel API key (starts with sk_) */
    apiKey: string;
    /** API endpoint URL */
    endpoint?: string;
    /** Default source identifier for events */
    source?: string;
    /** Whether to send events asynchronously (default: true) */
    async?: boolean;
    /** Whether tracking is enabled (default: true) */
    enabled?: boolean;
    /** Request timeout in milliseconds (default: 5000) */
    timeout?: number;
}
export interface TrackOptions {
    /** LLM model identifier (e.g., 'claude-sonnet-4-20250514') */
    model: string;
    /** Maximum cost in cents (budget enforcement) */
    budget_cents?: number;
    /** LLM provider (default: 'anthropic') */
    provider?: string;
    /** Source identifier for this call (overrides global) */
    source?: string;
    /** Tier/workflow identifier (e.g., 'router', 'deep_analysis') */
    tier?: string;
    /** Workflow key (defaults to tier if not provided) */
    workflow_key?: string;
    /** Custom metadata to attach to event */
    metadata?: Record<string, any>;
    /** Enforcement mode: 'reject' (default) or 'warn' */
    enforce_mode?: 'reject' | 'warn';
    /** Pre-calculated estimated cost in cents */
    estimated_cost_cents?: number;
    /** Unique ID for this logical request (for retry tracking) */
    request_id?: string;
    /** Which attempt this is (1, 2, 3...) */
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
/**
 * Sentinel SDK client
 *
 * @example
 * ```typescript
 * const sentinel = new Sentinel({
 *   apiKey: 'sk_...',
 *   source: 'my-app'
 * });
 *
 * const result = await sentinel.track(
 *   async () => {
 *     return await anthropic.messages.create({...});
 *   },
 *   {
 *     model: 'claude-sonnet-4-20250514',
 *     budget_cents: 50
 *   }
 * );
 * ```
 */
export declare class Sentinel {
    private config;
    private static readonly DEFAULT_ENDPOINT;
    private static readonly SDK_VERSION;
    constructor(config: SentinelConfig);
    /**
     * Track an LLM call with cost tracking and budget enforcement
     *
     * @param fn - Async function that executes the LLM call
     * @param opts - Tracking options
     * @returns Result from the tracked function
     * @throws {BudgetExceededError} When budget is exceeded and enforce_mode is 'reject'
     *
     * @example
     * ```typescript
     * const result = await sentinel.track(
     *   async () => anthropic.messages.create({...}),
     *   { model: 'claude-sonnet-4', budget_cents: 50 }
     * );
     * ```
     */
    track<T>(fn: () => Promise<T>, opts: TrackOptions): Promise<T>;
    private generateRequestId;
    /**
     * Configure the Sentinel client (updates existing config)
     *
     * @param config - Partial configuration to update
     */
    configure(config: Partial<SentinelConfig>): void;
    /**
     * Get current configuration
     */
    getConfig(): Readonly<Required<SentinelConfig>>;
    private executeAndTrack;
    private determineStatus;
    private calculateCost;
    private extractTokens;
    private buildMetadata;
    private sendEvent;
    private sendEventSync;
}
/**
 * Create a Sentinel instance with the given configuration
 *
 * @param config - Sentinel configuration
 * @returns Sentinel instance
 *
 * @example
 * ```typescript
 * const sentinel = createSentinel({
 *   apiKey: process.env.SENTINEL_API_KEY!,
 *   source: 'my-app'
 * });
 * ```
 */
export declare function createSentinel(config: SentinelConfig): Sentinel;
/**
 * Estimate token count from text
 * Rule of thumb: 1 token ≈ 4 characters
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 *
 * @example
 * ```typescript
 * const tokens = estimateTokens("Hello world");
 * // returns 3
 * ```
 */
export declare function estimateTokens(text: string): number;
export default Sentinel;
