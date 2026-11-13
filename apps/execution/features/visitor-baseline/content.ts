/** Fixed platform starter, never model output or private visitor goal material. */
export const helloWorldWorker = `export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    return new Response(request.method === 'HEAD' ? null : '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hello World</title></head><body style="margin:0;background:#faf9f6;color:#252525;font-family:system-ui,sans-serif"><main style="max-width:800px;margin:auto;padding:80px 32px"><h1 style="font-size:clamp(48px,8vw,88px);font-weight:500;letter-spacing:-0.06em;margin:0 0 20px">Hello, world.</h1><p style="color:#666;font-size:20px">The first page. Ready to grow.</p><small style="display:block;margin-top:48px;color:#777">Platform-provided starting page</small></main></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};
`;

export const helloWorldTests = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './output/worker.js';

test('serves the minimal platform Hello World page', async () => {
  const response = await worker.fetch(new Request('https://baseline.invalid/'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\\/html/);
  const body = await response.text();
  assert.match(body, /Hello, world\\./);
  assert.match(body, /Platform-provided starting page/);
});

test('has no application writes or active routes', async () => {
  assert.equal((await worker.fetch(new Request('https://baseline.invalid/', { method: 'POST' }))).status, 405);
  assert.equal(await (await worker.fetch(new Request('https://baseline.invalid/', { method: 'HEAD' }))).text(), '');
});
`;

export const helloWorldServices = '{"jobs":[]}\n';

export async function helloWorldBaselineHash(): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ worker: helloWorldWorker, tests: helloWorldTests, services: helloWorldServices }));

  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyHelloWorldResponse(response: Response): Promise<void> {
  if (response.status !== 200 || !response.headers.get('Content-Type')?.toLowerCase().startsWith('text/html')) throw new Error('Platform Hello World smoke failed');
  const reader = response.body?.getReader();

  if (!reader) throw new Error('Platform baseline response missing');
  let text = '';
  let bytes = 0;

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) break;
      bytes += chunk.value.length;

      if (bytes > 8192) throw new Error('Platform baseline response exceeds limit');
      text += new TextDecoder().decode(chunk.value);
    }
  } finally { await reader.cancel(); }

  if (!text.includes('Hello, world.</h1>') || !text.includes('Platform-provided starting page')) throw new Error('Platform baseline content mismatch');
}
