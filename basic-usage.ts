/**
 * Example: Using Sentinel SDK with Anthropic
 */

import Sentinel from '@sentinel-ai/sdk';
import Anthropic from '@anthropic-ai/sdk';

// Initialize Sentinel
const sentinel = new Sentinel({
  apiKey: process.env.SENTINEL_API_KEY!,
  source: 'example-app',
  async: true, // Send telemetry asynchronously
});

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

/**
 * Example 1: Basic usage with budget enforcement
 */
async function example1_BasicUsage() {
  console.log('\n--- Example 1: Basic Usage ---');

  try {
    const result = await sentinel.track(
      async () => {
        return await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 100,
          messages: [
            {
              role: 'user',
              content: 'Say hello in 5 words or less',
            },
          ],
        });
      },
      {
        model: 'claude-sonnet-4-20250514',
        budget_cents: 10, // Max 10 cents
        tier: 'example',
      }
    );

    console.log('Response:', result.content[0].text);
    console.log('✓ Call tracked successfully');
  } catch (error) {
    console.error('Error:', error);
  }
}

/**
 * Example 2: Multi-tier workflow
 */
async function example2_MultiTierWorkflow() {
  console.log('\n--- Example 2: Multi-Tier Workflow ---');

  const document = 'This is a sample legal contract...';

  // Step 1: Quick classification (cheap)
  const category = await sentinel.track(
    async () => {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: `Classify this document as: simple, medium, or complex\n\n${document}`,
          },
        ],
      });
      return response.content[0].text.toLowerCase();
    },
    {
      model: 'claude-haiku-4-5-20251001',
      budget_cents: 5,
      tier: 'classification',
      metadata: { step: 'classify' },
    }
  );

  console.log('Classification:', category);

  // Step 2: Deep analysis only if needed (expensive)
  if (category.includes('complex')) {
    const analysis = await sentinel.track(
      async () => {
        const response = await anthropic.messages.create({
          model: 'claude-opus-4-5-20251101',
          max_tokens: 2000,
          messages: [
            {
              role: 'user',
              content: `Perform detailed legal analysis:\n\n${document}`,
            },
          ],
        });
        return response.content[0].text;
      },
      {
        model: 'claude-opus-4-5-20251101',
        budget_cents: 150,
        tier: 'deep_analysis',
        metadata: { step: 'analyze' },
      }
    );

    console.log('Analysis:', analysis.substring(0, 100) + '...');
  }

  console.log('✓ Multi-tier workflow completed');
}

/**
 * Example 3: Error handling and retry with fallback
 */
async function example3_ErrorHandling() {
  console.log('\n--- Example 3: Error Handling ---');

  try {
    const result = await sentinel.track(
      async () => {
        return await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: 'Generate a long essay' }],
        });
      },
      {
        model: 'claude-sonnet-4-20250514',
        budget_cents: 5, // Intentionally low to trigger budget limit
        enforce_mode: 'reject',
      }
    );

    console.log('Success:', result.content[0].text.substring(0, 50));
  } catch (error) {
    console.log('Primary model failed, trying fallback...');

    // Fallback to cheaper model with warn mode
    const fallbackResult = await sentinel.track(
      async () => {
        return await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          messages: [{ role: 'user', content: 'Generate a short essay' }],
        });
      },
      {
        model: 'claude-haiku-4-5-20251001',
        budget_cents: 5,
        enforce_mode: 'warn', // Allow over-budget but log it
        tier: 'fallback',
      }
    );

    console.log('Fallback success:', fallbackResult.content[0].text.substring(0, 50));
  }
}

/**
 * Example 4: Custom metadata for debugging
 */
async function example4_CustomMetadata() {
  console.log('\n--- Example 4: Custom Metadata ---');

  const userId = 'user_123';
  const sessionId = 'session_456';

  const result = await sentinel.track(
    async () => {
      return await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Hello!' }],
      });
    },
    {
      model: 'claude-sonnet-4-20250514',
      metadata: {
        user_id: userId,
        session_id: sessionId,
        feature: 'chat_support',
        customer_tier: 'enterprise',
        region: 'us-west-2',
      },
    }
  );

  console.log('Response with metadata tracked:', result.content[0].text);
  console.log('✓ Metadata will appear in Sentinel dashboard');
}

/**
 * Example 5: Disable tracking for development
 */
async function example5_DisableTracking() {
  console.log('\n--- Example 5: Disable Tracking ---');

  const devSentinel = new Sentinel({
    apiKey: process.env.SENTINEL_API_KEY || 'sk_dev_key',
    enabled: process.env.NODE_ENV === 'production',
  });

  const result = await devSentinel.track(
    async () => {
      return await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Test message' }],
      });
    },
    {
      model: 'claude-sonnet-4-20250514',
    }
  );

  console.log('Result:', result.content[0].text);
  console.log(
    '✓ Tracking is',
    process.env.NODE_ENV === 'production' ? 'ENABLED' : 'DISABLED'
  );
}

/**
 * Run all examples
 */
async function main() {
  console.log('=== Sentinel SDK Examples ===\n');

  // Check for required environment variables
  if (!process.env.SENTINEL_API_KEY) {
    console.error('Error: SENTINEL_API_KEY environment variable is required');
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  try {
    await example1_BasicUsage();
    await example2_MultiTierWorkflow();
    await example3_ErrorHandling();
    await example4_CustomMetadata();
    await example5_DisableTracking();

    console.log('\n✓ All examples completed successfully!');
    console.log('\nCheck your Sentinel dashboard at:');
    console.log('https://sentinel-overwatch.fly.dev/dashboard');
  } catch (error) {
    console.error('\n✗ Error running examples:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
