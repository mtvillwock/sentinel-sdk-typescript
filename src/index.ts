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

export interface EnforceConstraints {
  maxCostCents: number;
  maxRetries?: number;
  mode?: 'warn' | 'reject';
}

export interface EnforceOptions {
  model: string;
  provider?: string;
  source?: string;
  tier?: string;
  metadata?: Record<string, any>;
  estimatedCostCents?: number;
  maxTokens?: number;
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

export class SentinelError extends Error {
  constructor(message: string, public readonly code: string, public readonly details?: any) {
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
      throw new SentinelError('API key is required', 'MISSING_API_KEY');
    }
    if (!this.config.apiKey.startsWith('sk_')) {
      console.warn('Sentinel: API key should start with sk_');
    }
  }

  async track<T>(fn: () => Promise<T>, opts: TrackOptions): Promise<T> {
    if (!this.config.enabled) {
      return await fn();
    }
    const trackOpts = {
      ...opts,
      request_id: opts.request_id || this.generateRequestId(),
      attempt_number: opts.attempt_number || 1,
    };
    return await this.executeAndTrack(fn, trackOpts);
  }

  async enforce<T>(
    constraints: EnforceConstraints,
    opts: EnforceOptions,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!this.config.enabled) {
      return await fn();
    }

    const mode = constraints.mode ?? 'reject';
    const estimate = this.estimatePreflightCost(opts.model, opts.estimatedCostCents, opts.maxTokens, opts.provider);

    if (mode === 'reject' && estimate > constraints.maxCostCents) {
      const rejectionEvent: SentinelEvent = {
        status: 'rejected',
        source: opts.source || this.config.source,
        model: opts.model,
        provider: opts.provider || 'anthropic',
        budget_cents: constraints.maxCostCents,
        duration_ms: 0,
        metadata: {
          ...(opts.metadata || {}),
          sdk_version: Sentinel.SDK_VERSION,
          sdk_language: 'typescript',
          ...(opts.tier ? { tier: opts.tier, workflow_key: opts.tier } : {}),
          rejected_reason: 'preflight_budget_exceeded',
          estimated_cost_cents: estimate,
          max_retries: constraints.maxRetries,
        },
        estimated_cost_cents: estimate,
        enforce_mode: mode,
      };
      await this.sendEvent(rejectionEvent);
      throw new BudgetExceededError(
        `Estimated cost ${estimate}¢ exceeds cap ${constraints.maxCostCents}¢. Execution rejected pre-flight.`,
        { estimated_cost_cents: estimate, max_cost_cents: constraints.maxCostCents, model: opts.model }
      );
    }

    return this.track(fn, {
      model: opts.model,
      provider: opts.provider,
      source: opts.source,
      tier: opts.tier,
      metadata: { ...(opts.metadata || {}), max_retries: constraints.maxRetries },
      budget_cents: constraints.maxCostCents,
      enforce_mode: mode,
      estimated_cost_cents: estimate,
    });
  }

  private estimatePreflightCost(model: string, estimatedCostCents?: number, maxTokens?: number, provider?: string): number {
    if (typeof estimatedCostCents === 'number') return estimatedCostCents;
    if (typeof maxTokens === 'number' && maxTokens > 0) {
      const cost = this.calculateCost(model, inputTokensFor(maxTokens), maxTokens, provider);
      return cost ?? 0;
    }
    return 0;
  }

  private generateRequestId(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `req_${hex}`;
  }

  configure(config: Partial<SentinelConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): Readonly<Required<SentinelConfig>> {
    return { ...this.config };
  }

  private async executeAndTrack<T>(
    fn: () => Promise<T>,
    opts: TrackOptions & { request_id: string; attempt_number: number }
  ): Promise<T> {
    const startTime = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      const { input_tokens, output_tokens } = this.extractTokens(result);
      const actual_cost_cents = this.calculateCost(opts.model, input_tokens, output_tokens, opts.provider);
      const status = this.determineStatus(actual_cost_cents, opts);
      const event: SentinelEvent = {
        status,
        source: opts.source || this.config.source,
        model: opts.model,
        provider: opts.provider || 'anthropic',
        budget_cents: opts.budget_cents,
        duration_ms: duration,
        metadata: this.buildMetadata(opts),
        input_tokens,
        output_tokens,
        estimated_cost_cents: opts.estimated_cost_cents,
        actual_cost_cents,
        enforce_mode: opts.enforce_mode || 'reject',
        request_id: opts.request_id,
        attempt_number: opts.attempt_number,
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
        request_id: opts.request_id,
        attempt_number: opts.attempt_number,
      };
      await this.sendEvent(event);
      throw error;
    }
  }

  private determineStatus(
    actual_cost_cents: number | undefined,
    opts: TrackOptions
  ): 'completed' | 'completed_over_budget' {
    if (
      opts.enforce_mode === 'warn' &&
      opts.budget_cents &&
      actual_cost_cents &&
      actual_cost_cents > opts.budget_cents
    ) {
      return 'completed_over_budget';
    }
    return 'completed';
  }

  /**
   * Providers whose calls have no per-token dollar cost (locally hosted models).
   * Calls tagged with these providers always cost 0 — never a phantom estimate
   * from the pricing-map fallback. Latency and retry data still flow normally;
   * only the dollar figure is zeroed.
   */
  private static readonly FREE_PROVIDERS = new Set(['local', 'ollama', 'llamacpp', 'lmstudio']);

  private calculateCost(
    model: string,
    input_tokens?: number,
    output_tokens?: number,
    provider?: string
  ): number | undefined {
    // Local/self-hosted models are free to run. Return 0 explicitly so they
    // never fall through to the pricing-map default and show a fake cost.
    if (provider && Sentinel.FREE_PROVIDERS.has(provider.toLowerCase())) {
      return 0;
    }

    if (!input_tokens || !output_tokens) return undefined;
    const pricing: Record<string, { input: number; output: number }> = {
      // Anthropic (cents per 1K tokens)
      'claude-sonnet-4-20250514': { input: 0.3, output: 1.5 },
      'claude-haiku-4-20250514': { input: 0.025, output: 0.125 },
      'claude-opus-4-20250514': { input: 1.5, output: 7.5 },

      // Cloudflare Workers AI ($0.20/M blended)
      '@cf/meta/llama-3.1-8b-instruct': { input: 0.02, output: 0.02 },
      '@cf/meta/llama-2-7b-chat-int8': { input: 0.02, output: 0.02 },
      '@cf/mistral/mistral-7b-instruct-v0.1': { input: 0.02, output: 0.02 },
      '@cf/qwen/qwen1.5-7b-chat-awq': { input: 0.02, output: 0.02 },

      // OpenAI (cents per 1K tokens) — VERIFY against current OpenAI pricing page
      'gpt-5.5': { input: 0.175, output: 1.4 },
      'gpt-5.3-codex': { input: 0.175, output: 1.4 },
      'gpt-4o': { input: 0.25, output: 1.0 },
      'gpt-4o-mini': { input: 0.015, output: 0.06 },
      'gpt-4.1-mini': { input: 0.04, output: 0.16 },
    };
    const rates = pricing[model] || { input: 0.3, output: 1.5 };
    return Math.ceil((input_tokens / 1000) * rates.input + (output_tokens / 1000) * rates.output);
  }

  /**
   * Extract token counts from a provider response, supporting both major shapes:
   *
   *   - input_tokens / output_tokens   → Anthropic, OpenAI Responses API, Cloudflare (manual)
   *   - prompt_tokens / completion_tokens → OpenAI Chat Completions API
   *
   * Returns {} when no usage is present (e.g. a rejected pre-flight call), which
   * causes calculateCost to return undefined rather than a wrong number.
   */
  private extractTokens(result: any): { input_tokens?: number; output_tokens?: number } {
    try {
      const usage = result?.usage;
      if (!usage) return {};

      // Anthropic / OpenAI Responses API / Cloudflare(manual): input_tokens/output_tokens
      if (typeof usage.input_tokens === 'number') {
        return { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
      }

      // OpenAI Chat Completions API: prompt_tokens/completion_tokens
      if (typeof usage.prompt_tokens === 'number') {
        return { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens };
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
    if (opts.tier) metadata.tier = opts.tier;
    if (!metadata.workflow_key && opts.tier) metadata.workflow_key = opts.tier;
    return metadata;
  }

  private async sendEvent(event: SentinelEvent): Promise<void> {
    if (this.config.async) {
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
        throw new SentinelError(`HTTP ${response.status}: ${errorBody}`, 'HTTP_ERROR', {
          status: response.status,
          body: errorBody,
        });
      }
      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof SentinelError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SentinelError(`Request timeout after ${this.config.timeout}ms`, 'TIMEOUT');
      }
      throw new SentinelError(error instanceof Error ? error.message : String(error), 'NETWORK_ERROR', error);
    }
  }
}

export function createSentinel(config: SentinelConfig): Sentinel {
  return new Sentinel(config);
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Worst-case input allowance for pre-flight estimates: ~25% of max output.
function inputTokensFor(maxTokens: number): number {
  return Math.ceil(maxTokens * 0.25);
}

export default Sentinel;
