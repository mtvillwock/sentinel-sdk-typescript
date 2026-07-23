/**
 * Unit tests for Sentinel.enforce()
 *
 * enforce() adds PRE-FLIGHT budget rejection on top of track():
 *   - reject mode (default): throws BudgetExceededError BEFORE running fn()
 *     if the estimated cost exceeds maxCostCents. fn() is never called.
 *   - warn mode: always runs fn(), flags over-budget after the fact.
 *   - under cap: runs fn() normally and records telemetry.
 *
 * Network is mocked via global.fetch so no real backend is hit.
 */

import { Sentinel, BudgetExceededError, SentinelError } from '../src/index';

// ---------------------------------------------------------------------------
// Test harness: capture every event posted to /api/events
// ---------------------------------------------------------------------------

let sentEvents: any[] = [];
let originalFetch: typeof global.fetch;

beforeEach(() => {
  sentEvents = [];
  originalFetch = global.fetch;

  // Mock fetch: record the body, return a successful response shape.
  global.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.body) {
      sentEvents.push(JSON.parse(init.body as string));
    }
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

function makeSentinel(overrides = {}) {
  return new Sentinel({
    apiKey: 'sk_test_12345',
    source: 'enforce-test',
    async: false, // synchronous so we can assert on sentEvents immediately
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// reject mode: pre-flight rejection
// ---------------------------------------------------------------------------

describe('enforce() — reject mode (pre-flight)', () => {
  it('throws BudgetExceededError when caller-supplied estimate exceeds cap', async () => {
    const sentinel = makeSentinel();
    const fn = jest.fn(async () => ({ usage: { input_tokens: 1, output_tokens: 1 } }));

    await expect(
      sentinel.enforce(
        { maxCostCents: 5, mode: 'reject' },
        { model: 'claude-opus-4-20250514', estimatedCostCents: 50 },
        fn
      )
    ).rejects.toBeInstanceOf(BudgetExceededError);

    // The actual call must NEVER run — that's the whole point of pre-flight.
    expect(fn).not.toHaveBeenCalled();
  });

  it('records a rejected event before throwing', async () => {
    const sentinel = makeSentinel();
    const fn = jest.fn(async () => ({}));

    await sentinel
      .enforce(
        { maxCostCents: 5, mode: 'reject' },
        { model: 'claude-opus-4-20250514', estimatedCostCents: 50, tier: 'deep_analysis' },
        fn
      )
      .catch(() => { }); // swallow the throw; we're asserting the side effect

    expect(sentEvents).toHaveLength(1);
    const event = sentEvents[0];
    expect(event.status).toBe('rejected');
    expect(event.estimated_cost_cents).toBe(50);
    expect(event.budget_cents).toBe(5);
    expect(event.enforce_mode).toBe('reject');
    expect(event.metadata.rejected_reason).toBe('preflight_budget_exceeded');
    expect(event.metadata.tier).toBe('deep_analysis');
  });

  it('defaults to reject mode when mode is omitted', async () => {
    const sentinel = makeSentinel();
    const fn = jest.fn(async () => ({}));

    await expect(
      sentinel.enforce(
        { maxCostCents: 5 }, // no mode → should default to 'reject'
        { model: 'claude-opus-4-20250514', estimatedCostCents: 50 },
        fn
      )
    ).rejects.toBeInstanceOf(BudgetExceededError);

    expect(fn).not.toHaveBeenCalled();
  });

  it('estimates worst-case cost from maxTokens when no estimate is supplied', async () => {
    const sentinel = makeSentinel();
    const fn = jest.fn(async () => ({}));

    // Opus output rate = 7.5¢/1K tokens. 4000 output tokens => 30¢, plus
    // input allowance (1000 tokens * 1.5¢/1K = 1.5¢) => ~32¢ >> 5¢ cap.
    await expect(
      sentinel.enforce(
        { maxCostCents: 5, mode: 'reject' },
        { model: 'claude-opus-4-20250514', maxTokens: 4000 },
        fn
      )
    ).rejects.toBeInstanceOf(BudgetExceededError);

    expect(fn).not.toHaveBeenCalled();
    expect(sentEvents[0].estimated_cost_cents).toBeGreaterThan(5);
  });

  it('includes estimate and cap in the thrown error details', async () => {
    const sentinel = makeSentinel();

    try {
      await sentinel.enforce(
        { maxCostCents: 5, mode: 'reject' },
        { model: 'claude-opus-4-20250514', estimatedCostCents: 50 },
        async () => ({})
      );
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExceededError);
      const err = e as BudgetExceededError;
      expect(err.code).toBe('BUDGET_EXCEEDED');
      expect(err.details.estimated_cost_cents).toBe(50);
      expect(err.details.max_cost_cents).toBe(5);
      expect(err.details.model).toBe('claude-opus-4-20250514');
    }
  });
});

// ---------------------------------------------------------------------------
// under cap: normal pass-through
// ---------------------------------------------------------------------------

describe('enforce() — under cap (pass-through)', () => {
  it('runs fn and returns its result when estimate is within cap', async () => {
    const sentinel = makeSentinel();
    const expected = { usage: { input_tokens: 10, output_tokens: 5 }, answer: 42 };
    const fn = jest.fn(async () => expected);

    const result = await sentinel.enforce(
      { maxCostCents: 100, mode: 'reject' },
      { model: 'claude-haiku-4-20250514', estimatedCostCents: 2 },
      fn
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe(expected);
  });

  it('records a completed event (not rejected) when under cap', async () => {
    const sentinel = makeSentinel();

    await sentinel.enforce(
      { maxCostCents: 100, mode: 'reject', maxRetries: 2 },
      { model: 'claude-haiku-4-20250514', estimatedCostCents: 2, tier: 'router' },
      async () => ({ usage: { input_tokens: 10, output_tokens: 5 } })
    );

    expect(sentEvents).toHaveLength(1);
    const event = sentEvents[0];
    expect(event.status).toBe('completed');
    expect(event.budget_cents).toBe(100);
    expect(event.enforce_mode).toBe('reject');
    expect(event.metadata.tier).toBe('router');
    // max_retries is threaded into metadata when supplied
    expect(event.metadata.max_retries).toBe(2);
  });

  it('runs fn even with no estimate basis (maxTokens and estimate both absent)', async () => {
    const sentinel = makeSentinel();
    const fn = jest.fn(async () => ({ usage: { input_tokens: 1, output_tokens: 1 } }));

    // estimate resolves to 0, which is <= any positive cap → pass through.
    const result = await sentinel.enforce(
      { maxCostCents: 5, mode: 'reject' },
      { model: 'claude-sonnet-4-20250514' },
      fn
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// warn mode: never reject pre-flight
// ---------------------------------------------------------------------------

describe('enforce() — warn mode', () => {
  it('runs fn even when estimate exceeds cap', async () => {
    const sentinel = makeSentinel();
    const fn = jest.fn(async () => ({ usage: { input_tokens: 100, output_tokens: 100 } }));

    const result = await sentinel.enforce(
      { maxCostCents: 5, mode: 'warn' },
      { model: 'claude-opus-4-20250514', estimatedCostCents: 50 },
      fn
    );

    // warn mode never blocks execution
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });

  it('flags over-budget via completed_over_budget when actual exceeds cap', async () => {
    const sentinel = makeSentinel();

    // Opus: 100 in + 100 out. input 1.5¢/1K, output 7.5¢/1K → ceil(0.15 + 0.75) = 1¢.
    // Use a cap below the actual to force over-budget. Actual here is small, so
    // use a tiny cap of... actually compute: we need actual > cap.
    // 1000 output tokens on opus = 7.5¢. Cap at 1¢ → over budget.
    await sentinel.enforce(
      { maxCostCents: 1, mode: 'warn' },
      { model: 'claude-opus-4-20250514', estimatedCostCents: 50 },
      async () => ({ usage: { input_tokens: 200, output_tokens: 1000 } })
    );

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].status).toBe('completed_over_budget');
  });

  it('does not emit a separate rejection event in warn mode', async () => {
    const sentinel = makeSentinel();

    await sentinel.enforce(
      { maxCostCents: 5, mode: 'warn' },
      { model: 'claude-opus-4-20250514', estimatedCostCents: 50 },
      async () => ({ usage: { input_tokens: 10, output_tokens: 5 } })
    );

    // exactly one event, and it is not a rejection
    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].status).not.toBe('rejected');
  });
});

// ---------------------------------------------------------------------------
// failure propagation: fn throws after passing pre-flight
// ---------------------------------------------------------------------------

describe('enforce() — failure handling', () => {
  it('records a failed event and rethrows when fn throws under cap', async () => {
    const sentinel = makeSentinel();
    const boom = new Error('provider exploded');

    await expect(
      sentinel.enforce(
        { maxCostCents: 100, mode: 'reject' },
        { model: 'claude-haiku-4-20250514', estimatedCostCents: 2 },
        async () => {
          throw boom;
        }
      )
    ).rejects.toThrow('provider exploded');

    expect(sentEvents).toHaveLength(1);
    expect(sentEvents[0].status).toBe('failed');
    expect(sentEvents[0].failure_reason).toContain('provider exploded');
  });
});

// ---------------------------------------------------------------------------
// disabled client: enforce is a no-op wrapper
// ---------------------------------------------------------------------------

describe('enforce() — disabled client', () => {
  it('runs fn without enforcement when enabled=false', async () => {
    const sentinel = makeSentinel({ enabled: false });
    const fn = jest.fn(async () => ({ ok: true }));

    // Even with an over-cap estimate, a disabled client should just run fn.
    const result = await sentinel.enforce(
      { maxCostCents: 1, mode: 'reject' },
      { model: 'claude-opus-4-20250514', estimatedCostCents: 999 },
      fn
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
    // No events sent when disabled
    expect(sentEvents).toHaveLength(0);
  });
});
