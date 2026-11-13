import { afterEach, expect, it, vi } from 'vitest';
import { LiveGate, ResearchAdapter, TrustedUploader } from '../../packages/provider-adapters/src/cloudflare';

function liveGate() {
  return new LiveGate({ activated: true, dailyAllowanceUsd: 5 }, {
    reserve: async () => ({ id: 'fixture-reservation' }),
    settle: async () => {},
  });
}

afterEach(() => vi.unstubAllGlobals());

it('uploads a scoped credential-free bundle through default fetch without binding the adapter receiver', async () => {
  let uploads = 0;
  vi.stubGlobal('fetch', async function (this: TrustedUploader | ResearchAdapter | typeof globalThis | undefined, input: string | URL | Request, init?: RequestInit) {
    if (this instanceof TrustedUploader || this instanceof ResearchAdapter) throw new Error('Illegal invocation: adapter receiver');
    uploads++;
    expect(String(input)).toBe('https://api.cloudflare.com/client/v4/accounts/arti-account/workers/dispatch/namespaces/arti-preview/scripts/evaluation-fixture');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toEqual({ Authorization: 'Bearer fixture-deployment-token' });
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body;

    if (!(form instanceof FormData)) throw new Error('Expected upload form');
    const metadata = form.get('metadata');

    if (!(metadata instanceof Blob)) throw new Error('Expected metadata blob');
    expect(JSON.parse(await metadata.text())).toEqual({ main_module: 'worker.js', compatibility_date: '2026-10-12', bindings: [] });
    const module = form.get('worker.js');

    if (!(module instanceof Blob)) throw new Error('Expected worker module');
    expect(await module.text()).toBe('export default { fetch() { return new Response("fixture") } }');

    return Response.json({ success: true });
  });
  const uploader = new TrustedUploader('arti-account', 'fixture-deployment-token', liveGate());
  await uploader.upload('builder-1', 'arti-preview', { mainModule: 'worker.js', modules: [{ name: 'worker.js', content: 'export default { fetch() { return new Response("fixture") } }', type: 'application/javascript+module' }] }, 'evaluation-fixture');
  expect(uploads).toBe(1);
});

it('retrieves an allowlisted untrusted source through default fetch without binding the adapter receiver', async () => {
  vi.stubGlobal('fetch', async function (this: TrustedUploader | ResearchAdapter | typeof globalThis | undefined, input: string | URL | Request, init?: RequestInit) {
    if (this instanceof TrustedUploader || this instanceof ResearchAdapter) throw new Error('Illegal invocation: adapter receiver');
    expect(String(input)).toBe('https://sources.example/fixture');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toEqual({ Accept: 'text/plain,text/html,application/json' });

    return new Response('Untrusted fixture content', { headers: { 'Content-Type': 'text/plain' } });
  });
  const research = new ResearchAdapter(['sources.example'], liveGate());
  const result = await research.retrieve('researcher', 'https://sources.example/fixture');
  expect(result.text).toBe('Untrusted fixture content');
  expect(result.trust).toBe('untrusted');
});
