/// <reference types="node" />
/**
 * Live provider + Sentinel integration script.
 *
 * NOT a Jest test. Hits real provider APIs and the live Sentinel backend.
 *   export SENTINEL_API_KEY=sk_...
 *   export CLOUDFLARE_ACCOUNT_ID=...      (for Cloudflare test)
 *   export CLOUDFLARE_API_TOKEN=...       (for Cloudflare test)
 *   export OPENAI_API_KEY=sk-...          (for OpenAI test)
 *   npx ts-node src/integration.script.ts
 *
 * Tests run independently — missing creds for one provider skip that test
 * rather than aborting the whole script.
 */
import { Sentinel, estimateTokens } from './index';

// ============================================================================
// Cloudflare Workers AI
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
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, max_tokens: 100 }),
  });
  if (!response.ok) {
    throw new Error(`Cloudflare API error: ${response.status}`);
  }
  return await response.json();
}

// ============================================================================
// OpenAI Responses API
// ============================================================================

interface OpenAIResponse {
  output?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function callOpenAIResponsesAPI(
  apiKey: string,
  model: string,
  prompt: string,
  maxOutputTokens: number
): Promise<OpenAIResponse> {
  const url = 'https://api.openai.com/v1/responses';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: prompt, // Responses API: "input" not "messages"
      max_output_tokens: maxOutputTokens, // not "max_tokens"
    }),
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`OpenAI API error: ${response.status} — ${errorBody}`);
  }
  return (await response.json()) as OpenAIResponse;
}

// Pull the first output_text out of the Responses API shape.
function extractOpenAIText(resp: OpenAIResponse): string {
  const msg = resp.output?.find((o) => o.type === 'message');
  const textItem = msg?.content?.find((c) => c.type === 'output_text');
  return textItem?.text ?? '';
}

// ============================================================================
// Tests
// ============================================================================

function haveVars(vars: string[]): boolean {
  return vars.every((v) => !!process.env[v]);
}

async function testCloudflare(sentinel: Sentinel) {
  console.log('\n🧪 Cloudflare integration');
  if (!haveVars(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'])) {
    console.log('⏭️  Skipped (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set)');
    return;
  }

  const prompt = 'What is 2+2?';
  const model = '@cf/meta/llama-3.1-8b-instruct';

  try {
    const result = await sentinel.track(
      async () => {
        const cf = await callCloudflareAPI(
          process.env.CLOUDFLARE_ACCOUNT_ID!,
          process.env.CLOUDFLARE_API_TOKEN!,
          model,
          prompt
        );
        // Cloudflare doesn't return token counts — attach estimates.
        return {
          ...cf,
          usage: {
            input_tokens: estimateTokens(prompt),
            output_tokens: estimateTokens(cf.result.response),
          },
        };
      },
      { model, provider: 'cloudflare', budget_cents: 5, tier: 'test' }
    );
    console.log('✅ Response:', result.result.response.slice(0, 60));
    console.log(`📊 Tokens: ${result.usage.input_tokens} in / ${result.usage.output_tokens} out`);
  } catch (error) {
    console.error('❌ Cloudflare FAILED:', error);
  }
}

async function testOpenAI(sentinel: Sentinel) {
  console.log('\n🧪 OpenAI integration');
  if (!haveVars(['OPENAI_API_KEY'])) {
    console.log('⏭️  Skipped (OPENAI_API_KEY not set)');
    return;
  }

  const prompt = 'What is 2+2?';
  const model = 'gpt-5.5';

  try {
    const result = await sentinel.track(
      async () =>
        // Responses API returns usage.input_tokens / output_tokens natively,
        // so extractTokens() handles it with no manual attachment.
        callOpenAIResponsesAPI(process.env.OPENAI_API_KEY!, model, prompt, 100),
      { model, provider: 'openai', budget_cents: 10, tier: 'test' }
    );
    console.log('✅ Response:', extractOpenAIText(result).slice(0, 60));
    console.log(
      `📊 Tokens: ${result.usage?.input_tokens} in / ${result.usage?.output_tokens} out`
    );
  } catch (error) {
    console.error('❌ OpenAI FAILED:', error);
  }
}

async function testOpenAIEnforce(sentinel: Sentinel) {
  console.log('\n🧪 OpenAI enforce() pre-flight rejection');
  if (!haveVars(['OPENAI_API_KEY'])) {
    console.log('⏭️  Skipped (OPENAI_API_KEY not set)');
    return;
  }

  let fnRan = false;
  try {
    await sentinel.enforce(
      { maxCostCents: 1, mode: 'reject' },
      { model: 'gpt-5.5', maxTokens: 8000, provider: 'openai', tier: 'expensive' },
      async () => {
        fnRan = true;
        return callOpenAIResponsesAPI(process.env.OPENAI_API_KEY!, 'gpt-5.5', 'hi', 8000);
      }
    );
    console.error('❌ Expected rejection but the OpenAI call ran (and cost money!)');
  } catch (error: any) {
    if (error?.code === 'BUDGET_EXCEEDED' && !fnRan) {
      console.log('✅ Rejected pre-flight — no OpenAI call made, no spend incurred');
    } else {
      console.error('❌ Unexpected error:', error);
    }
  }
}

async function main() {
  if (!process.env.SENTINEL_API_KEY) {
    console.error('❌ Missing SENTINEL_API_KEY');
    console.error('Run: export SENTINEL_API_KEY=sk_...');
    process.exit(1);
  }

  const sentinel = new Sentinel({
    apiKey: process.env.SENTINEL_API_KEY,
    endpoint: process.env.SENTINEL_ENDPOINT || 'https://sentinel-overwatch.fly.dev',
    source: 'integration-test',
    async: false,
  });

  await testCloudflare(sentinel);
  await testOpenAI(sentinel);
  await testOpenAIEnforce(sentinel);

  console.log('\n📊 Check dashboard: https://sentinel-overwatch.fly.dev/dashboard');
}

main().catch((error) => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
