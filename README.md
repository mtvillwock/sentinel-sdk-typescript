# Sentinel SDK for Node.js

**Visibility and receipts for your AI.**

Track LLM costs, enforce budgets, and maintain audit trails for AI workflows — all with a simple wrapper around your existing code.

[![npm version](https://badge.fury.io/js/%40sentinel-ai%2Fsdk.svg)](https://www.npmjs.com/package/@sentinel-ai/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🎯 **Budget Enforcement** - Set cost caps and prevent runaway spend
- 📊 **Real-time Tracking** - See costs, latency, and token usage in your dashboard
- 🔍 **Audit Trails** - Every LLM call logged with full context
- 🚀 **Framework Agnostic** - Works with any LLM provider or framework
- 🪶 **Lightweight** - Zero dependencies, minimal overhead
- 🔒 **Type Safe** - Full TypeScript support

## Installation

```bash
npm install @sentinel-ai/sdk
```

Or with yarn:

```bash
yarn add @sentinel-ai/sdk
```

## Quick Start

### 1. Get Your API Key

Sign up at [sentinel-overwatch.fly.dev](https://sentinel-overwatch.fly.dev) and grab your API key.

### 2. Wrap Your LLM Calls

```typescript
import Sentinel from '@sentinel-ai/sdk';
import Anthropic from '@anthropic-ai/sdk';

// Initialize Sentinel
const sentinel = new Sentinel({
  apiKey: process.env.SENTINEL_API_KEY!,
  source: 'my-app',
});

// Initialize your LLM client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Wrap your LLM call with Sentinel tracking
async function processDocument(content: string) {
  const result = await sentinel.track(
    async () => {
      return await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content }],
      });
    },
    {
      model: 'claude-sonnet-4-20250514',
      budget_cents: 50, // Reject if estimated cost > 50 cents
      tier: 'document_processing',
      metadata: {
        document_type: 'contract',
        user_id: 'user_123',
      },
    }
  );

  return result;
}
```

### 3. View Your Dashboard

Visit your Sentinel dashboard to see:
- Cost per call, per workflow, per tier
- Token usage and latency metrics
- Budget enforcement events
- Complete audit trail

## Configuration

### Basic Configuration

```typescript
const sentinel = new Sentinel({
  apiKey: 'sk_...', // Required: Your Sentinel API key
  source: 'my-app', // Optional: App identifier (default: 'unknown')
  endpoint: 'https://sentinel-overwatch.fly.dev', // Optional: Custom endpoint
  async: true, // Optional: Send events asynchronously (default: true)
  enabled: true, // Optional: Enable/disable tracking (default: true)
  timeout: 5000, // Optional: Request timeout in ms (default: 5000)
});
```

### Environment Variables

```bash
# Recommended: Store your API key in environment variables
export SENTINEL_API_KEY=sk_...
export SENTINEL_SOURCE=my-app
```

```typescript
const sentinel = new Sentinel({
  apiKey: process.env.SENTINEL_API_KEY!,
  source: process.env.SENTINEL_SOURCE,
});
```

## Usage Examples

### Budget Enforcement

Prevent runaway costs with budget caps:

```typescript
try {
  const result = await sentinel.track(
    async () => await expensiveOperation(),
    {
      model: 'claude-opus-4-5-20251101',
      budget_cents: 100, // Max 100 cents ($1.00)
      enforce_mode: 'reject', // Reject if budget exceeded
    }
  );
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.log('Budget exceeded:', error.message);
    // Handle budget overflow gracefully
  }
}
```

### Multi-Tier Workflows

Track different tiers of processing separately:

```typescript
// Quick classification (cheap)
const category = await sentinel.track(
  async () => await classifyDocument(doc),
  {
    model: 'claude-haiku-4-5-20251001',
    budget_cents: 5,
    tier: 'classification',
  }
);

// Deep analysis (expensive, only if needed)
if (category === 'complex') {
  const analysis = await sentinel.track(
    async () => await analyzeDocument(doc),
    {
      model: 'claude-opus-4-5-20251101',
      budget_cents: 150,
      tier: 'deep_analysis',
    }
  );
}
```

### Multiple Providers

Works with any LLM provider:

```typescript
import OpenAI from 'openai';

const openai = new OpenAI();

const result = await sentinel.track(
  async () => {
    return await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'Hello!' }],
    });
  },
  {
    model: 'gpt-4.1',
    provider: 'openai',
    budget_cents: 25,
  }
);
```

### Custom Metadata

Add context for better debugging and audit trails:

```typescript
const result = await sentinel.track(
  async () => await processUserQuery(query),
  {
    model: 'claude-sonnet-4-20250514',
    metadata: {
      user_id: req.user.id,
      session_id: req.session.id,
      feature: 'chat_support',
      customer_tier: 'enterprise',
    },
  }
);
```

### Disable for Development

```typescript
const sentinel = new Sentinel({
  apiKey: process.env.SENTINEL_API_KEY!,
  enabled: process.env.NODE_ENV === 'production', // Only track in prod
});
```

### Warn Mode (Don't Block)

Allow over-budget calls but log them:

```typescript
const result = await sentinel.track(
  async () => await llmCall(),
  {
    model: 'claude-sonnet-4',
    budget_cents: 50,
    enforce_mode: 'warn', // Log warning but don't reject
  }
);
```

## API Reference

### `new Sentinel(config)`

Creates a Sentinel client.

**Parameters:**
- `config.apiKey` (string, required) - Your Sentinel API key
- `config.source` (string, optional) - Application identifier
- `config.endpoint` (string, optional) - Custom API endpoint
- `config.async` (boolean, optional) - Send events asynchronously (default: true)
- `config.enabled` (boolean, optional) - Enable tracking (default: true)
- `config.timeout` (number, optional) - Request timeout in ms (default: 5000)

### `sentinel.track(fn, options)`

Tracks an LLM call with cost and budget enforcement.

**Parameters:**
- `fn` (async function) - Function that executes the LLM call
- `options.model` (string, required) - LLM model identifier
- `options.budget_cents` (number, optional) - Maximum cost in cents
- `options.provider` (string, optional) - Provider name (default: 'anthropic')
- `options.source` (string, optional) - Override global source
- `options.tier` (string, optional) - Workflow tier identifier
- `options.metadata` (object, optional) - Custom metadata
- `options.enforce_mode` ('reject' | 'warn', optional) - Budget enforcement mode

**Returns:** Promise resolving to the result of `fn()`

**Throws:** `BudgetExceededError` when budget is exceeded (in 'reject' mode)

### `sentinel.configure(config)`

Updates the Sentinel configuration.

```typescript
sentinel.configure({
  source: 'new-app-name',
  enabled: false,
});
```

### `sentinel.getConfig()`

Returns the current configuration.

```typescript
const config = sentinel.getConfig();
console.log(config.source); // 'my-app'
```

## Error Handling

### BudgetExceededError

Thrown when a call would exceed the budget cap (in 'reject' mode):

```typescript
import { BudgetExceededError } from '@sentinel-ai/sdk';

try {
  await sentinel.track(fn, { budget_cents: 10 });
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.log('Budget exceeded:', error.message);
    console.log('Details:', error.details);
  }
}
```

### SentinelError

Base error class for all Sentinel errors:

```typescript
import { SentinelError } from '@sentinel-ai/sdk';

try {
  await sentinel.track(fn, options);
} catch (error) {
  if (error instanceof SentinelError) {
    console.log('Error code:', error.code);
    console.log('Details:', error.details);
  }
}
```

## Best Practices

### 1. Set Reasonable Budgets

Base budgets on typical costs plus a buffer:

```typescript
// Typical cost: $0.03, budget: $0.05 (67% buffer)
budget_cents: 5
```

### 2. Use Tiers for Multi-Step Workflows

```typescript
const tiers = {
  router: { model: 'haiku', budget_cents: 5 },
  quick_scan: { model: 'sonnet', budget_cents: 15 },
  deep_analysis: { model: 'opus', budget_cents: 150 },
};
```

### 3. Add Context with Metadata

```typescript
metadata: {
  user_id: user.id,
  feature: 'document_review',
  document_size_kb: doc.size / 1024,
}
```

### 4. Handle Failures Gracefully

```typescript
try {
  return await sentinel.track(fn, opts);
} catch (error) {
  if (error instanceof BudgetExceededError) {
    // Fallback to cheaper model
    return await sentinel.track(fallbackFn, cheaperOpts);
  }
  throw error;
}
```

### 5. Use Async Mode in Production

```typescript
const sentinel = new Sentinel({
  apiKey: process.env.SENTINEL_API_KEY!,
  async: true, // Don't block on telemetry
});
```

## TypeScript Support

Full TypeScript definitions included:

```typescript
import Sentinel, {
  SentinelConfig,
  TrackOptions,
  SentinelEvent,
  BudgetExceededError,
} from '@sentinel-ai/sdk';

const config: SentinelConfig = {
  apiKey: 'sk_...',
  source: 'my-app',
};

const sentinel = new Sentinel(config);
```

## Testing

### Unit Tests

```typescript
import Sentinel from '@sentinel-ai/sdk';

describe('My LLM Service', () => {
  it('tracks calls correctly', async () => {
    const sentinel = new Sentinel({
      apiKey: 'sk_test_...',
      enabled: false, // Disable in tests
    });

    const result = await sentinel.track(
      async () => mockLLMCall(),
      { model: 'test-model' }
    );

    expect(result).toBeDefined();
  });
});
```

### Integration Tests

```typescript
// Use test API key for integration tests
const sentinel = new Sentinel({
  apiKey: process.env.SENTINEL_TEST_API_KEY!,
  endpoint: 'http://localhost:4000', // Local Sentinel instance
});
```

## Troubleshooting

### Events Not Appearing in Dashboard

1. **Check API key**: Ensure it starts with `sk_`
2. **Verify endpoint**: Default is `https://sentinel-overwatch.fly.dev`
3. **Check network**: Ensure your app can reach the Sentinel API
4. **Enable sync mode**: Set `async: false` to see errors immediately

```typescript
const sentinel = new Sentinel({
  apiKey: 'sk_...',
  async: false, // See errors immediately
});
```

### TypeScript Errors

Ensure you have TypeScript 5.0+ and proper type definitions:

```bash
npm install --save-dev @types/node typescript
```

### Budget Always Rejected

The SDK sends raw results to Sentinel for cost calculation. If you're seeing unexpected rejections:

1. Check your budget is reasonable for the model
2. Review your dashboard for actual costs
3. Use `enforce_mode: 'warn'` to see costs without blocking

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- **Documentation**: [https://docs.sentinel.ai](https://docs.sentinel.ai)
- **Dashboard**: [https://sentinel-overwatch.fly.dev](https://sentinel-overwatch.fly.dev)
- **Issues**: [GitHub Issues](https://github.com/sentinel-ai/sentinel-sdk-node/issues)
- **Email**: support@sentinel.ai

## Roadmap

- [ ] Python SDK
- [ ] Go SDK
- [ ] Streaming support
- [ ] Batch operations
- [ ] Local storage fallback
- [ ] Enhanced retry logic

---

**Built by developers who got tired of surprise LLM bills.**
