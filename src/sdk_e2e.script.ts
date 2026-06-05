/// <reference types="node" />
/**
 * SDK → Server E2E verification script.
 *
 * NOT a Jest test. Run manually against a live (or local) Sentinel backend:
 *   export SENTINEL_API_KEY=sk_...
 *   npx ts-node src/sdk_e2e.script.ts
 *
 * Exercises: basic track, retry sequence, Cloudflare provider, OpenAI provider.
 */
import { Sentinel } from './index';

async function main() {
  if (!process.env.SENTINEL_API_KEY) {
    console.error('❌ Missing SENTINEL_API_KEY');
    console.error('Run: export SENTINEL_API_KEY=sk_...');
    process.exit(1);
  }

  const sentinel = new Sentinel({
    apiKey: process.env.SENTINEL_API_KEY,
    endpoint: process.env.SENTINEL_ENDPOINT || 'https://sentinel-overwatch.fly.dev',
    source: 'e2e-test',
    async: false,
  });

  console.log('Testing SDK → Server integration...\n');

  // Test 1: Basic successful call
  console.log('Test 1: Basic successful call');
  try {
    const result = await sentinel.track(
      async () => ({ usage: { input_tokens: 150, output_tokens: 75 } }),
      {
        model: 'claude-sonnet-4-20250514',
        source: 'E2E SDK test script',
        tier: 'classification',
        budget_cents: 100,
        provider: 'anthropic',
      }
    );
    console.log('✓ Success:', result);
  } catch (e) {
    console.log('✗ Failed:', e);
  }

  // Test 2: Retry sequence (same request_id, incrementing attempt)
  console.log('\nTest 2: Retry sequence');
  const requestId = `req_test_${Date.now()}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const shouldFail = attempt < 3;
      await sentinel.track(
        async () => {
          if (shouldFail) throw new Error('Simulated timeout');
          return { usage: { input_tokens: 100, output_tokens: 50 } };
        },
        {
          model: 'claude-sonnet-4-20250514',
          source: 'E2E SDK test script',
          tier: 'document_summary',
          request_id: requestId,
          attempt_number: attempt,
          provider: 'anthropic',
        }
      );
      console.log(`✓ Attempt ${attempt}: Success`);
    } catch (e) {
      console.log(`✓ Attempt ${attempt}: Failed (expected)`);
    }
  }

  // Test 3: Cloudflare provider
  console.log('\nTest 3: Cloudflare provider');
  try {
    await sentinel.track(
      async () => ({ usage: { input_tokens: 200, output_tokens: 100 } }),
      {
        model: '@cf/meta/llama-3.1-8b-instruct',
        source: 'E2E SDK test script',
        tier: 'router',
        budget_cents: 50,
        provider: 'cloudflare',
      }
    );
    console.log('✓ Cloudflare event sent');
  } catch (e) {
    console.log('✗ Failed:', e);
  }

  // Test 4: OpenAI provider
  // OpenAI Responses API returns usage.input_tokens / usage.output_tokens
  // natively, so extractTokens() picks them up with no manual attachment.
  console.log('\nTest 4: OpenAI provider');
  try {
    await sentinel.track(
      async () => ({
        // Mirror the OpenAI Responses API shape the SDK will see in prod.
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Hello from gpt-5.5' }],
          },
        ],
        usage: { input_tokens: 120, output_tokens: 60 },
      }),
      {
        model: 'gpt-5.5',
        source: 'E2E SDK test script',
        tier: 'generation',
        budget_cents: 50,
        provider: 'openai',
      }
    );
    console.log('✓ OpenAI event sent');
  } catch (e) {
    console.log('✗ Failed:', e);
  }

  // Test 5: OpenAI enforce() pre-flight rejection
  // gpt-5.5 worst-case for 8000 tokens far exceeds a 2-cent cap → rejected
  // before the function ever runs.
  console.log('\nTest 5: OpenAI enforce() pre-flight rejection');
  let fnRan = false;
  try {
    await sentinel.enforce(
      { maxCostCents: 2, mode: 'reject' },
      { model: 'gpt-5.5', maxTokens: 8000, provider: 'openai', tier: 'expensive_gen' },
      async () => {
        fnRan = true;
        return { usage: { input_tokens: 2000, output_tokens: 8000 } };
      }
    );
    console.log('✗ Expected rejection but call ran');
  } catch (e: any) {
    if (e?.code === 'BUDGET_EXCEEDED' && !fnRan) {
      console.log('✓ Rejected pre-flight (function never ran)');
    } else {
      console.log('✗ Unexpected error:', e);
    }
  }

  console.log('\n--- Check dashboard ---');
  console.log('Verify:');
  console.log('  1. Three events from retry sequence share same Request ID');
  console.log('  2. Attempt numbers show 1, 2, 3');
  console.log('  3. First two show as failed, third as completed');
  console.log('  4. Cloudflare event shows provider = cloudflare');
  console.log('  5. OpenAI event shows provider = openai, ~120 in / 60 out tokens');
  console.log('  6. OpenAI enforce rejection shows status = rejected');
}

main().catch(console.error);
