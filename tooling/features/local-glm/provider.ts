import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const execute = promisify(execFile);

export const glmModel = '@cf/zai-org/glm-4.7-flash';

// Verified against the provider's model documentation, 2026-10-13.
export const glmPricing = { input: 0.0605, output: 0.4 };

export type LocalModelInput = { instructions: string; context: string; code: boolean };

export type LocalModelResult = { content: string; usage?: { prompt_tokens: number; completion_tokens: number } };

export type LocalModel = (input: LocalModelInput) => Promise<LocalModelResult>;

const resultSchema = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({ content: z.string().min(1) }) })).length(1), usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).optional() });

/** Use the developer's explicit API token or existing Wrangler login; never expose credentials to prompts. */
async function credential(): Promise<string> {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const path = join(homedir(), 'Library/Preferences/.wrangler/config/default.toml');
  let config = await readFile(path, 'utf8');
  const expiry = config.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1];

  if (!expiry || Date.parse(expiry) <= Date.now()) {
    // Wrangler owns OAuth refresh; stdout is deliberately discarded.
    await execute(process.execPath, [join(process.cwd(), 'node_modules/wrangler/bin/wrangler.js'), 'whoami'], { timeout: 60_000, maxBuffer: 64_000 });
    config = await readFile(path, 'utf8');
  }

  const token = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];

  if (!token) throw new Error('LOCAL_GLM_CREDENTIAL_REQUIRED');

  return token;
}

export function cloudflareLocalModel(accountId: string): LocalModel {
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error('Invalid account');

  return async input => {
    const token = await credential();

    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${glmModel}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(input.code ? 120_000 : 60_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: input.instructions }, { role: 'user', content: input.context }], stream: false, chat_template_kwargs: { enable_thinking: false }, max_completion_tokens: input.code ? 8192 : 2048, temperature: input.code ? 0.3 : 0.7, response_format: { type: 'json_schema', json_schema: { name: input.code ? 'local_website' : 'local_conversation', strict: true, schema: { type: 'object', properties: input.code ? { html: { type: 'string' }, body: { type: 'string' } } : { body: { type: 'string' } }, required: input.code ? ['html', 'body'] : ['body'], additionalProperties: false } } } }),
    });

    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'LOCAL_GLM_AUTH_REQUIRED' : 'LOCAL_GLM_PROVIDER_FAILED');
    const envelope = z.object({ success: z.literal(true), result: resultSchema }).parse(await response.json());
    const choice = envelope.result.choices[0];

    if (choice.finish_reason === 'length') throw new Error('LOCAL_GLM_OUTPUT_LIMIT');

    return { content: choice.message.content, usage: envelope.result.usage };
  };
}

export function reservationFor(input: LocalModelInput): number {
  const bytes = Buffer.byteLength(input.instructions + input.context);

  if (bytes > 80_000) throw new Error('LOCAL_GLM_CONTEXT_LIMIT');

  // One byte per input token plus framing slack is deliberately conservative.
  return ((bytes + 2048) * glmPricing.input + (input.code ? 8192 : 2048) * glmPricing.output) / 1_000_000;
}
