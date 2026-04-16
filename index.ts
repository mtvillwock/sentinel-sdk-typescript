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
  /** Custom metadata to attach to event */
  metadata?: Record<string, any>;
  /** Enforcement mode: 'reject' (default) or 'warn' */
  enforce_mode?: 'reject' | 'warn';
  /** Pre-calculated estimated cost in cents */
  estimated_cost_cents?: number;
}

export interface SentinelEvent {
  status: 'completed' | 'completed_over_budget' | 'rejected' | 'failed';
  source?: string;
  model: string;
  provider: string;
  budget_cents?: number;
  duration_ms: number;
  metadata?: Record<string, any>;
  raw_result?: any;
  input_tokens?: number;
  output_tokens?: number;
  actual_cost_cents?: number;
  failure_reason?: string;
  enforce_mode?: string;
}

export interface SentinelResponse {
  id: string;
  status: string;
}

export class SentinelError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'SentinelError';
  }
}

export class BudgetExceededError extends SentinelError {
  constructor(message: string, details?: any) {
    super(message, 'BUDGET_EXCEEDED', details);
    this.name = 'BudgetExceededError';
  }
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
export class Sentinel {
  private config: Required<SentinelConfig>;
  private static readonly DEFAULT_ENDPOINT = 'https://sentinel-overwatch.fly.dev';
  private static readonly SDK_VERSION = '0.1.0';

  constructor(config: SentinelConfig) {
    this.config = {
      apiKey: config.apiKey,
      endpoint: config.endpoint || Sentinel.DEFAULT_ENDPOINT,
      source: config.source || 'unknown',
      async: config.async ?? true,
      enabled: config.enabled ?? true,
      timeout: config.timeout || 5000,
    };

    if (!this.config.apiKey) {
      throw new SentinelError(
        'API key is required',
        'MISSING_API_KEY'
      );
    }

    if (!this.config.apiKey.startsWith('sk_')) {
      console.warn('Sentinel: API key should start with sk_');
    }
  }

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
  async track<T>(
    fn: () => Promise<T>,
    opts: TrackOptions
  ): Promise<T> {
    if (!this.config.enabled) {
      return await fn();
    }

    return await this.executeAndTrack(fn, opts);
  }

  /**
   * Configure the Sentinel client (updates existing config)
   * 
   * @param config - Partial configuration to update
   */
  configure(config: Partial<SentinelConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<Required<SentinelConfig>> {
    return { ...this.config };
  }

  private async executeAndTrack<T>(
    fn: () => Promise<T>,
    opts: TrackOptions
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await fn();
      const duration = Date.now() - startTime;

      const { input_tokens, output_tokens } = this.extractTokens(result);

      const event: SentinelEvent = {
        status: 'completed',
        source: opts.source || this.config.source,
        model: opts.model,
        provider: opts.provider || 'anthropic',
        budget_cents: opts.budget_cents,
        duration_ms: duration,
        metadata: this.buildMetadata(opts),
        raw_result: result,
        input_tokens,
        output_tokens,
        enforce_mode: opts.enforce_mode || 'reject',
      };

      await this.sendEvent(event);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      const event: SentinelEvent = {
        status: 'failed',
        source: opts.source || this.config.source,
        model: opts.model,
        provider: opts.provider || 'anthropic',
        budget_cents: opts.budget_cents,
        duration_ms: duration,
        metadata: this.buildMetadata(opts),
        failure_reason: error instanceof Error ? error.message : String(error),
        enforce_mode: opts.enforce_mode || 'reject',
      };

      await this.sendEvent(event);

      throw error;
    }
  }

  private extractTokens(result: any): {
    input_tokens?: number;
    output_tokens?: number;
  } {
    try {
      // Handle Anthropic SDK response shape
      if (result?.usage) {
        return {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
        };
      }

      // Handle OpenAI SDK response shape
      if (result?.usage?.prompt_tokens) {
        return {
          input_tokens: result.usage.prompt_tokens,
          output_tokens: result.usage.completion_tokens,
        };
      }

      return {};
    } catch {
      return {};
    }
  }

  private buildMetadata(opts: TrackOptions): Record<string, any> {
    const metadata: Record<string, any> = {
      ...(opts.metadata || {}),
      sdk_version: Sentinel.SDK_VERSION,
      sdk_language: 'typescript',
    };

    if (opts.tier) {
      metadata.tier = opts.tier;
    }

    return metadata;
  }

  private async sendEvent(event: SentinelEvent): Promise<void> {
    if (this.config.async) {
      // Fire and forget
      this.sendEventSync(event).catch((error) => {
        console.error('Sentinel: Failed to send event', error);
      });
    } else {
      await this.sendEventSync(event);
    }
  }

  private async sendEventSync(event: SentinelEvent): Promise<SentinelResponse> {
    const url = `${this.config.endpoint}/api/events`;

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'x-sdk-version': Sentinel.SDK_VERSION,
      'x-sdk-language': 'typescript',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(event),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unknown error');
        throw new SentinelError(
          `HTTP ${response.status}: ${errorBody}`,
          'HTTP_ERROR',
          { status: response.status, body: errorBody }
        );
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof SentinelError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new SentinelError(
          `Request timeout after ${this.config.timeout}ms`,
          'TIMEOUT'
        );
      }

      throw new SentinelError(
        error instanceof Error ? error.message : String(error),
        'NETWORK_ERROR',
        error
      );
    }
  }
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
export function createSentinel(config: SentinelConfig): Sentinel {
  return new Sentinel(config);
}

// Default export
export default Sentinel;
