/// <reference types="node" />
import { Sentinel } from './index';

async function main() {
  // const sentinel = new Sentinel({
  //   apiKey: process.env.SENTINEL_API_KEY || 'sk_test_12345',
  //   endpoint: process.env.SENTINEL_ENDPOINT || 'http://localhost:4000',
  //   source: 'e2e-test',
  //   async: false, // Wait for response
  // });
  // const sentinel = new Sentinel({
  //   apiKey: process.env.SENTINEL_API_KEY!,  // Real key from env
  //   endpoint: 'https://sentinel-overwatch.fly.dev',  // Production
  //   source: 'e2e-test',
  //   async: false,
  // });

  // Same pattern that works in integration.test.ts
  if (!process.env.SENTINEL_API_KEY) {
    console.error('❌ Missing SENTINEL_API_KEY');
    console.error('Run: export SENTINEL_API_KEY=sk_...');
    process.exit(1);
  }

  const sentinel = new Sentinel({
    apiKey: process.env.SENTINEL_API_KEY,  // From environment
    endpoint: process.env.SENTINEL_ENDPOINT || 'https://sentinel-overwatch.fly.dev',
    source: 'e2e-test',
    async: false,
  });

  console.log('Testing SDK → Server integration...\n');

  // Test 1: Basic successful call
  console.log('Test 1: Basic successful call');
  try {
    const result = await sentinel.track(
      async () => ({
        usage: { input_tokens: 150, output_tokens: 75 }
      }),
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
      async () => ({
        usage: { input_tokens: 200, output_tokens: 100 }
      }),
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

  console.log('\n--- Check dashboard at http://localhost:4000/dashboard ---');
  console.log('Verify:');
  console.log('  1. Three events from retry sequence share same Request ID');
  console.log('  2. Attempt numbers show 1, 2, 3');
  console.log('  3. First two show as failed, third as completed');
  console.log('  4. Cloudflare event shows provider = cloudflare');
  console.log('  5. Audit panel shows updated waste calculation');
}

main().catch(console.error);
