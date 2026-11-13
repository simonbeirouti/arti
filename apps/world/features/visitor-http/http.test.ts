import { describe, expect, it } from 'vitest';
import { handleVisitorRequest, hashVisitorToken, type VisitorGateway } from './http';

function gateway() {
  const calls: unknown[][] = [];

  const api: VisitorGateway = {
    session: async hash => { calls.push(['session', hash]);

 return { id: 'server-visitor', name: 'Avery' }; },
    onboard: async (hash, name, ip) => { calls.push(['onboard', hash, name, ip]);

 return { id: 'server-visitor', name }; },
    suggest: async (...values) => { calls.push(['suggest', ...values]);

 return { id: 'suggestion-1', visitorId: 'visitor-1', visitorName: 'Avery', text: 'Build a useful calendar', createdAt: new Date().toISOString(), status: 'pending', votes: [] }; },
  };

  return { api, calls };
}

function post(path: string, value: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(`https://public.example/api/v1/visitor/${path}`, { method: 'POST', headers: { Origin: 'https://public.example', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
}

describe('ARTI-VISITOR-HTTP-001 public visitor intake', () => {
  it('issues opaque secure cookie and sends only its hash to world authority', async () => {
    const { api, calls } = gateway();
    const response = await handleVisitorRequest(post('session', { name: ' Avery ' }), api, '1.2.3.4');
    expect(response.status).toBe(200);
    const cookie = response.headers.get('Set-Cookie')!;
    expect(cookie).toMatch(/^__Host-arti_visitor=[a-f0-9]{64}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure$/);
    const token = cookie.split(';')[0].split('=')[1];
    expect(calls[0]).toEqual(['onboard', await hashVisitorToken(token), 'Avery', await hashVisitorToken('visitor-ip:1.2.3.4')]);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('requires onboarding and ignores forged caller identity', async () => {
    const { api, calls } = gateway();
    expect((await handleVisitorRequest(post('suggestions', { text: 'Build a useful calendar', idempotencyKey: 'request-1' }), api, 'ip')).status).toBe(401);
    expect((await handleVisitorRequest(post('session', { name: 'Avery', visitorId: 'operator' }), api, 'ip')).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it('rejects cross-site and missing-origin mutations before accessing storage', async () => {
    const { api, calls } = gateway();

    const untrusted: Record<string, string>[] = [{ Origin: '' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }];

    for (const headers of untrusted) expect((await handleVisitorRequest(post('session', { name: 'Avery' }, headers), api, 'ip')).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it('derives submission identity from scoped cookie and enforces strict request limits', async () => {
    const { api, calls } = gateway();
    const token = 'a'.repeat(64);
    const value = { text: 'Build a useful calendar', idempotencyKey: 'request-1' };
    expect((await handleVisitorRequest(post('suggestions', value, { Cookie: `operator=secret; __Host-arti_visitor=${token}` }), api, 'ip')).status).toBe(200);
    expect(calls[0]).toEqual(['suggest', await hashVisitorToken(token), value.text, value.idempotencyKey, await hashVisitorToken('visitor-ip:ip')]);
    expect((await handleVisitorRequest(post('session', { name: 'a'.repeat(9000) }), api, 'ip')).status).toBe(413);
    expect((await handleVisitorRequest(post('suggestions', { ...value, actor: 'steward' }), api, 'ip')).status).toBe(400);
  });
  it('maps limit and idempotency errors without leaking private world errors', async () => {
    const { api } = gateway();

    for (const [message, status] of [['Intake limit', 429], ['idempotency conflict', 409], ['private secret reason', 400]] as const) {
      api.onboard = async () => { throw new Error(message); };

      const response = await handleVisitorRequest(post('session', { name: 'Avery' }), api, 'ip');
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain(message);
    }
  });
});
