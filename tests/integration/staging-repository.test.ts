import { expect, it } from 'vitest';
import { CloudflareAdmin } from '../../tooling/staging/provider';
import { ensureCanonicalRepository } from '../../tooling/staging/provision';

const metadata = { name: 'builder-1', default_branch: 'main', read_only: false, last_push_at: null };

function success(result: string | number | boolean | null | Record<string, string | boolean | null> | { id: string }[]): Response {
  return Response.json({ success: true, result });
}

it('accepts the documented creation response and revokes issued tokens without returning credentials', async () => {
  const calls: string[] = [];
  let exists = false;
  let tokenActive = true;

  const admin = new CloudflareAdmin('ADMIN_SECRET', 'account', async (request, init) => {
    const url = new URL(String(request));
    calls.push(`${init?.method} ${url.pathname}`);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ADMIN_SECRET');

    if (url.pathname.endsWith('/tokens') && init?.method === 'GET') return success(tokenActive ? [{ id: 'issued-token' }] : []);

    if (init?.method === 'DELETE') { tokenActive = false;

 return success({ id: 'issued-token' }); }

    if (init?.method === 'POST') { exists = true;

 return success({ id: 'repo-1', name: 'builder-1', default_branch: 'main', remote: 'https://account.artifacts.cloudflare.net/git/arti/builder-1.git', token: 'PRIVATE_CREATION_TOKEN' }); }

    return exists ? success(metadata) : new Response('', { status: 404 });
  });

  expect(await ensureCanonicalRepository(admin, 'arti', 'builder-1', true)).toEqual(metadata);
  expect(tokenActive).toBe(false);
  expect(calls.filter(call => call.startsWith('DELETE'))).toHaveLength(1);
  const retry = await ensureCanonicalRepository(admin, 'arti', 'builder-1', true);
  expect(retry).toEqual(metadata);
  expect(JSON.stringify(retry)).not.toContain('PRIVATE_CREATION_TOKEN');
  expect(calls.filter(call => call.startsWith('POST'))).toHaveLength(1);
  expect(calls.filter(call => call.startsWith('DELETE'))).toHaveLength(1);
});

it('recovers interrupted empty repository token revocation but leaves populated repositories untouched', async () => {
  const revoked: string[] = [];
  let populated = false;

  const admin = new CloudflareAdmin('token', 'account', async (request, init) => {
    const url = new URL(String(request));

    if (url.pathname.endsWith('/tokens')) return success([{ id: 'left-after-interruption' }]);

    if (init?.method === 'DELETE') { revoked.push(url.pathname);

 return success({ id: 'left-after-interruption' }); }

    expect(init?.method).toBe('GET');

    return success({ ...metadata, last_push_at: populated ? '2026-10-12T00:00:00Z' : null });
  });

  await ensureCanonicalRepository(admin, 'arti', 'builder-1', true);
  expect(revoked).toHaveLength(1);
  populated = true;
  await ensureCanonicalRepository(admin, 'arti', 'builder-1', true);
  expect(revoked).toHaveLength(1);
});

it('keeps inspect read-only and rejects metadata drift before revoking any existing token', async () => {
  const methods: string[] = [];
  let drift = false;

  const admin = new CloudflareAdmin('token', 'account', async (_request, init) => {
    methods.push(init?.method ?? '');

    return success({ ...metadata, read_only: drift });
  });

  await ensureCanonicalRepository(admin, 'arti', 'builder-1', false);
  expect(methods).toEqual(['GET']);
  drift = true;
  await expect(ensureCanonicalRepository(admin, 'arti', 'builder-1', true)).rejects.toThrow('drift');
  expect(methods).toEqual(['GET', 'GET']);
});

it('does not echo malformed provider bodies that may contain credentials', async () => {
  const admin = new CloudflareAdmin('secret', 'account', async () => new Response('{"token":"PRIVATE_CREDENTIAL", broken', { status: 200 }));
  await expect(admin.call('GET', '/accounts/account/artifacts/namespaces', (await import('zod')).z.json())).rejects.toThrow('Cloudflare response was not valid JSON');
});
