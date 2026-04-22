"use strict";
/**
 * Sentinel SDK for Node.js/TypeScript
 *
 * Cost-aware execution runtime for LLM workflows.
 * Tracks spend, enforces budgets, and sends telemetry to your Sentinel dashboard.
 *
 * @packageDocumentation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sentinel = exports.BudgetExceededError = exports.SentinelError = void 0;
exports.createSentinel = createSentinel;
exports.estimateTokens = estimateTokens;
class SentinelError extends Error {
    constructor(message, code, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'SentinelError';
    }
}
exports.SentinelError = SentinelError;
class BudgetExceededError extends SentinelError {
    constructor(message, details) {
        super(message, 'BUDGET_EXCEEDED', details);
        this.name = 'BudgetExceededError';
    }
}
exports.BudgetExceededError = BudgetExceededError;
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
class Sentinel {
    constructor(config) {
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
    async track(fn, opts) {
        if (!this.config.enabled) {
            return await fn();
        }
        // Generate request_id if not provided
        const trackOpts = {
            ...opts,
            request_id: opts.request_id || this.generateRequestId(),
            attempt_number: opts.attempt_number || 1,
        };
        return await this.executeAndTrack(fn, trackOpts);
    }
    generateRequestId() {
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        const hex = Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        return `req_${hex}`;
    }
    /**
     * Configure the Sentinel client (updates existing config)
     *
     * @param config - Partial configuration to update
     */
    configure(config) {
        this.config = {
            ...this.config,
            ...config,
        };
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    async executeAndTrack(fn, opts) {
        const startTime = Date.now();
        try {
            const result = await fn();
            const duration = Date.now() - startTime;
            const { input_tokens, output_tokens } = this.extractTokens(result);
            const actual_cost_cents = this.calculateCost(opts.model, input_tokens, output_tokens);
            const status = this.determineStatus(actual_cost_cents, opts);
            const event = {
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
        }
        catch (error) {
            const duration = Date.now() - startTime;
            const event = {
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
    determineStatus(actual_cost_cents, opts) {
        if (opts.enforce_mode === 'warn' &&
            opts.budget_cents &&
            actual_cost_cents &&
            actual_cost_cents > opts.budget_cents) {
            return 'completed_over_budget';
        }
        return 'completed';
    }
    calculateCost(model, input_tokens, output_tokens) {
        if (!input_tokens || !output_tokens)
            return undefined;
        // Simplified pricing (cents per 1K tokens)
        const pricing = {
            // Anthropic models
            'claude-sonnet-4-20250514': { input: 0.3, output: 1.5 },
            'claude-haiku-4-20250514': { input: 0.025, output: 0.125 },
            'claude-opus-4-20250514': { input: 1.5, output: 7.5 },
            // Cloudflare Workers AI models ($0.20/M tokens blended)
            // Using same rate for input/output since Cloudflare charges blended
            '@cf/meta/llama-3.1-8b-instruct': { input: 0.02, output: 0.02 },
            '@cf/meta/llama-2-7b-chat-int8': { input: 0.02, output: 0.02 },
            '@cf/mistral/mistral-7b-instruct-v0.1': { input: 0.02, output: 0.02 },
            '@cf/qwen/qwen1.5-7b-chat-awq': { input: 0.02, output: 0.02 },
        };
        const rates = pricing[model] || { input: 0.3, output: 1.5 };
        return Math.ceil((input_tokens / 1000) * rates.input + (output_tokens / 1000) * rates.output);
    }
    extractTokens(result) {
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
            // TODO: do we need something here for Cloudflare or is that handled in calculateCost?
            return {};
        }
        catch {
            return {};
        }
    }
    buildMetadata(opts) {
        const metadata = {
            ...(opts.metadata || {}),
            sdk_version: Sentinel.SDK_VERSION,
            sdk_language: 'typescript',
        };
        if (opts.tier) {
            metadata.tier = opts.tier;
        }
        // Ensure workflow_key is set (use tier as fallback)
        if (!metadata.workflow_key && opts.tier) {
            metadata.workflow_key = opts.tier;
        }
        return metadata;
    }
    async sendEvent(event) {
        if (this.config.async) {
            // Fire and forget
            this.sendEventSync(event).catch((error) => {
                console.error('Sentinel: Failed to send event', error);
            });
        }
        else {
            await this.sendEventSync(event);
        }
    }
    async sendEventSync(event) {
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
                throw new SentinelError(`HTTP ${response.status}: ${errorBody}`, 'HTTP_ERROR', { status: response.status, body: errorBody });
            }
            return await response.json();
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof SentinelError) {
                throw error;
            }
            if (error instanceof Error && error.name === 'AbortError') {
                throw new SentinelError(`Request timeout after ${this.config.timeout}ms`, 'TIMEOUT');
            }
            throw new SentinelError(error instanceof Error ? error.message : String(error), 'NETWORK_ERROR', error);
        }
    }
}
exports.Sentinel = Sentinel;
Sentinel.DEFAULT_ENDPOINT = 'https://sentinel-overwatch.fly.dev';
Sentinel.SDK_VERSION = '0.1.0';
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
function createSentinel(config) {
    return new Sentinel(config);
}
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
function estimateTokens(text) {
    if (!text)
        return 0;
    return Math.ceil(text.length / 4);
}
// Default export
exports.default = Sentinel;
//# sourceMappingURL=index.js.map