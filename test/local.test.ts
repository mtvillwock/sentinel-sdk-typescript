/**
 * Locks in: local / self-hosted LLM calls NEVER produce a phantom dollar cost.
 *
 * The regression this guards: calculateCost falls back to the Sonnet default
 * rate for any unknown model. An Ollama model like "llama3.1:8b" is unknown to
 * the pricing map, so without an explicit free-provider branch it would report
 * a fabricated cost — making free local usage look expensive on the dashboard.
 *
 * Local calls must report cost = 0 (free), while STILL flowing tokens, latency,
 * status, and retry data normally. Only the dollar figure is zeroed.
 */

import { Sentinel, BudgetExceededError } from '../src/index';

let sentEvents: any[] = [];
let originalFetch: typeof global.fetch;

beforeEach(() => {
  sentEvents = [];
  originalFetch = global.fetch;
  global.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.body) sentEvents.push(JSON.parse(init.body as string));
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'evt_test', status: 'ok' }),
      text: async () => 'ok',
    } as unknown as Response;
  }) as unknown as typeof global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

function makeSentinel() {
  return new Sentinel({ apiKey: 'sk_test_12345', source: 'local-test', async: false });
}

describe('local providers — zero cost, never phantom', () => {
  it('ollama call reports cost 0, not the Sonnet-default fallback', async () => {
    const sentinel = makeSentinel();

    await sentinel.track(
      // Ollama returns prompt_eval_count/eval_count, but devs typically map to
      // the standard usage shape; here we use prompt/completion tokens.
      async () => ({ usage: { prompt_tokens: 5000, completion_tokens: 5000 } }),
      { model: 'llama3.1:8b', provider: 'ollama', tier: 'router' }
    );

    const event = sentEvents[0];
    // 5000+5000 tokens at the Sonnet fallback (0.3/1.5) would be ~9¢.
    // It MUST be 0 because provider is free.
    expect(event.actual_cost_cents).toBe(0);
  });

  it('still records tokens, latency, status, and tier for local calls', async () => {
    const sentinel = makeSentinel();

    await sentinel.track(
      async () => ({ usage: { prompt_tokens: 120, completion_tokens: 60 } }),
      { model: 'mistral', provider: 'ollama', tier: 'classification' }
    );

    const event = sentEvents[0];
    expect(event.actual_cost_cents).toBe(0);    // free
    expect(event.input_tokens).toBe(120);        // tokens still flow
    expect(event.output_tokens).toBe(60);
    expect(event.status).toBe('completed');      // status still flows
    expect(event.metadata.tier).toBe('classification');
    expect(typeof event.duration_ms).toBe('number'); // latency still captured
  });

  it.each(['local', 'ollama', 'llamacpp', 'lmstudio', 'OLLAMA', 'Local'])(
    'treats provider "%s" as free (case-insensitive)',
    async (provider) => {
      const sentinel = makeSentinel();
      await sentinel.track(
        async () => ({ usage: { prompt_tokens: 9999, completion_tokens: 9999 } }),
        { model: 'some-local-model', provider }
      );
      expect(sentEvents[0].actual_cost_cents).toBe(0);
    }
  );

  it('does NOT zero out cloud providers (guard against over-broad matching)', async () => {
    const sentinel = makeSentinel();

    await sentinel.track(
      async () => ({ usage: { prompt_tokens: 1000, completion_tokens: 1000 } }),
      { model: 'claude-sonnet-4-20250514', provider: 'anthropic' }
    );

    // sonnet: 1000/1000*0.3 + 1000/1000*1.5 = 1.8 → ceil = 2. Must NOT be 0.
    expect(sentEvents[0].actual_cost_cents).toBe(2);
  });
});

describe('enforce() with local providers', () => {
  it('never rejects a local call on budget (pre-flight estimate is 0)', async () => {
    const sentinel = makeSentinel();
    const fn = jest.fn(async () => ({ usage: { prompt_tokens: 8000, completion_tokens: 8000 } }));

    // A huge token count with a tiny cap WOULD reject a cloud model.
    // For a free provider the estimate is 0, so it must pass through.
    const result = await sentinel.enforce(
      { maxCostCents: 1, mode: 'reject' },
      { model: 'llama3.1:70b', provider: 'ollama', maxTokens: 8000, tier: 'heavy_local' },
      fn
    );

    expect(fn).toHaveBeenCalledTimes(1);   // ran — not rejected
    expect(result).toBeDefined();
    expect(sentEvents[0].status).toBe('completed');
    expect(sentEvents[0].actual_cost_cents).toBe(0);
  });

  it('still rejects an equivalent cloud call (contrast case)', async () => {
    const sentinel = makeSentinel();
    const fn = jest.fn(async () => ({}));

    await expect(
      sentinel.enforce(
        { maxCostCents: 1, mode: 'reject' },
        { model: 'gpt-5.5', provider: 'openai', maxTokens: 8000 },
        fn
      )
    ).rejects.toBeInstanceOf(BudgetExceededError);

    expect(fn).not.toHaveBeenCalled();   // rejected pre-flight
  });
});
