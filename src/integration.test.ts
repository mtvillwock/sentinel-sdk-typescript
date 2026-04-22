/**
 * Minimal Cloudflare + Sentinel Integration Test
 *
 * Prerequisites:
 * 1. Update SDK with changes from SDK_PATCH.md
 * 2. Set environment variables (see bottom of file)
 * 3. Run: npx ts-node test-integration.ts
 */

import { Sentinel, estimateTokens } from './index';  // Adjust path to your SDK

// ============================================================================
// Simple Cloudflare API wrapper
// ============================================================================

async function callCloudflareAPI(
  accountId: string,
  apiToken: string,
  model: string,
  prompt: string
) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      max_tokens: 100,
    }),
  });

  if (!response.ok) {
    throw new Error(`Cloudflare API error: ${response.status}`);
  }

  return await response.json();
}

// ============================================================================
// Test: Cloudflare with Sentinel Tracking
// ============================================================================

async function testCloudflareIntegration() {
  console.log('🧪 Testing Cloudflare + Sentinel Integration\n');

  // 1. Validate environment
  const requiredVars = ['SENTINEL_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'];
  const missing = requiredVars.filter(v => !process.env[v]);

  if (missing.length > 0) {
    console.error('❌ Missing environment variables:', missing.join(', '));
    console.error('\nRun: export SENTINEL_API_KEY=sk_... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=...');
    process.exit(1);
  }

  // 2. Initialize Sentinel
  const sentinel = new Sentinel({
    apiKey: process.env.SENTINEL_API_KEY!,
    source: 'test-integration',
  });

  // 3. Test with Cloudflare
  const prompt = 'What is 2+2?';
  const model = '@cf/meta/llama-3.1-8b-instruct';

  console.log(`📝 Prompt: "${prompt}"`);
  console.log(`🤖 Model: ${model}`);
  console.log(`💰 Budget: 5 cents\n`);

  try {
    const result = await sentinel.track(
      async () => {
        // Call Cloudflare
        const cfResponse = await callCloudflareAPI(
          process.env.CLOUDFLARE_ACCOUNT_ID!,
          process.env.CLOUDFLARE_API_TOKEN!,
          model,
          prompt
        );

        // Manually attach token estimates (Cloudflare doesn't provide them)
        return {
          ...cfResponse,
          usage: {
            input_tokens: estimateTokens(prompt),
            output_tokens: estimateTokens(cfResponse.result.response),
          },
        };
      },
      {
        model,
        provider: 'cloudflare',
        budget_cents: 5,
        tier: 'test',
      }
    );

    // 4. Validate result
    console.log('✅ API call succeeded');
    console.log(`📤 Response: "${result.result.response}"`);
    console.log(`📊 Tokens: ${result.usage.input_tokens} in, ${result.usage.output_tokens} out`);

    // 5. Verify cost calculation
    const totalTokens = result.usage.input_tokens + result.usage.output_tokens;
    const expectedCost = Math.ceil((totalTokens / 1000) * 0.02);  // $0.02 per 1K tokens
    console.log(`💵 Estimated cost: ${expectedCost} cents`);

    console.log('\n✅ Integration test PASSED');
    console.log('📊 Check Sentinel dashboard: https://sentinel-overwatch.fly.dev/dashboard');

  } catch (error) {
    console.error('❌ Test FAILED:', error);
    throw error;
  }
}

// ============================================================================
// Run Test
// ============================================================================

testCloudflareIntegration().catch((error) => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});

/**
 * ENVIRONMENT SETUP
 *
 * Create a .env file or export these:
 *
 * export SENTINEL_API_KEY="sk_your_sentinel_key"
 * export CLOUDFLARE_ACCOUNT_ID="your_cloudflare_account_id"
 * export CLOUDFLARE_API_TOKEN="your_cloudflare_api_token"
 *
 * Get Cloudflare credentials:
 * 1. Visit https://dash.cloudflare.com
 * 2. Go to Workers AI section
 * 3. Click "Use REST API"
 * 4. Copy Account ID
 * 5. Create API Token (Workers AI Read permission)
 */
