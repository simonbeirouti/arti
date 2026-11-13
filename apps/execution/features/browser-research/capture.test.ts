import { expect, it } from 'vitest';
import { BrowserResearch, type BrowserCaptureBinding, type CaptureStore } from './capture';
import { LiveGate } from '../../../../packages/provider-adapters/src/cloudflare';

it('keeps URL research private, restricts browser requests, and hashes stored provenance', async () => {
  const saved = new Map<string, ArrayBuffer | string>();
  const calls: BrowserRunScreenshotOptions[] = [];

  const browser: BrowserCaptureBinding = { async quickAction(_action, options) { calls.push(options);

 return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }); } };

  const store: CaptureStore = { async put(key, content) { saved.set(key, content);

 return null; } };

  const gate = new LiveGate({ activated: true, dailyAllowanceUsd: 1 }, { reserve: async () => ({ id: 'reservation' }), settle: async () => {} });
  const research = new BrowserResearch(browser, store, gate, ['docs.example.com']);
  await expect(research.capture('researcher', 'https://evil.example/')).rejects.toThrow('not approved');
  expect(calls).toHaveLength(0);
  const result = await research.capture('researcher', 'https://docs.example.com/guide');
  expect(result.visibility).toBe('private');
  expect(result.key).toMatch(/^private-research\/researcher\//);
  expect(result.sha256).toHaveLength(64);
  expect(JSON.parse(String(saved.get(result.provenanceKey)))).toMatchObject({ visibility: 'private', source: 'https://docs.example.com/guide', sha256: result.sha256, trust: 'untrusted' });
  expect(calls[0]).toMatchObject({ setJavaScriptEnabled: false, allowRequestPattern: ['^https://docs\\.example\\.com(/|$)'] });
  const fixture = await research.capturePublicFixture('researcher', 'public-demo', '<p>Known public fixture</p>');
  expect(fixture.visibility).toBe('public-safe');
  expect(calls[1]).toMatchObject({ rejectRequestPattern: ['.*'] });
});

it('does not run a browser while simulation or zero allowance is configured', async () => {
  let invoked = false;
  const gate = new LiveGate({ activated: false, dailyAllowanceUsd: 0 }, { reserve: async () => { throw new Error('Never reserve'); }, settle: async () => {} });

  const research = new BrowserResearch({ async quickAction() { invoked = true;

 return new Response(); } }, { put: async () => null }, gate, ['docs.example.com']);

  await expect(research.capture('researcher', 'https://docs.example.com/')).rejects.toThrow('disabled');
  expect(invoked).toBe(false);
});
