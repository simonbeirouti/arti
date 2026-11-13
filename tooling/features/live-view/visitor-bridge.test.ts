import { expect, it, vi } from 'vitest';
import { APPROVED_WORLD_SOURCE, visitorBridge } from './visitor-bridge';

const token = 'a'.repeat(64);

function local(path: string, value: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:5173/api/v1/visitor/${path}`, { method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
}

function sessionRemote() {
  return vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ visitor: { id: 'server-owned', name: 'Avery' } }, { headers: { 'Set-Cookie': `__Host-arti_visitor=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`, 'X-Private-Diagnostic': 'secret' } }));
}

it('bridges public onboarding and remaps only the secure visitor cookie to the separate local browser session', async () => {
  const remote = sessionRemote();
  const response = await visitorBridge(local('session', { name: ' Avery ' }, { Authorization: 'operator-token', Cookie: `arti_session=operator; arti_live_visitor=${token}; __Host-arti_visitor=${'b'.repeat(64)}`, 'Cf-Access-Jwt-Assertion': 'secret', 'CF-Connecting-IP': 'forged' }), APPROVED_WORLD_SOURCE, remote, 'onboarding');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ visitor: { id: 'server-owned', name: 'Avery' } });
  expect(response.headers.getSetCookie()).toEqual([`arti_live_visitor=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`]);
  expect(response.headers.has('X-Private-Diagnostic')).toBe(false);
  const [url, init] = remote.mock.calls[0];
  expect(url).toBe(`${APPROVED_WORLD_SOURCE}/api/v1/visitor/session`);
  expect(init?.redirect).toBe('error');
  expect(init?.credentials).toBe('omit');
  expect(Object.fromEntries(new Headers(init?.headers))).toEqual({ accept: 'application/json', 'content-type': 'application/json', cookie: `__Host-arti_visitor=${token}`, origin: APPROVED_WORLD_SOURCE, 'sec-fetch-site': 'same-origin' });
  expect(init?.body).toBe(JSON.stringify({ name: 'Avery' }));
});

it('retrieves the canonical visitor session without leaking unrelated credentials', async () => {
  const remote = sessionRemote();
  const response = await visitorBridge(new Request('http://127.0.0.1:5173/api/v1/visitor/session', { headers: { Cookie: `arti_live_visitor=${token}; arti_session=private`, Authorization: 'secret' } }), APPROVED_WORLD_SOURCE, remote);
  expect(response.status).toBe(200);
  expect(Object.fromEntries(new Headers(remote.mock.calls[0][1]?.headers))).toEqual({ accept: 'application/json', cookie: `__Host-arti_visitor=${token}` });
});

it('rejects foreign/missing origins, cross-site requests, unknown hosts, ports, queries, paths and methods before forwarding', async () => {
  const remote = sessionRemote();
  const headers: Record<string, string>[] = [{ Origin: '' }, { Origin: 'http://evil.example' }, { Origin: 'http://127.0.0.1:5173' }, { 'Sec-Fetch-Site': 'cross-site' }];

  for (const value of headers) expect((await visitorBridge(local('session', { name: 'Avery' }, value), APPROVED_WORLD_SOURCE, remote)).status).toBe(403);

  for (const url of ['http://evil.example/api/v1/visitor/session', 'http://localhost:9999/api/v1/visitor/session', 'http://localhost:5173/api/v1/visitor/session?target=x', 'http://localhost:5173/api/v1/world', 'http://localhost:5173/mcp']) expect((await visitorBridge(new Request(url), APPROVED_WORLD_SOURCE, remote)).status).toBe(403);
  expect((await visitorBridge(new Request('http://localhost:5173/api/v1/visitor/suggestions'), APPROVED_WORLD_SOURCE, remote)).status).toBe(405);
  expect((await visitorBridge(local('session', { name: 'Avery' }), 'https://evil.example', remote)).status).toBe(403);
  expect(remote).not.toHaveBeenCalled();
});

it('rejects actor spoofing, malformed requests and oversized streamed bodies', async () => {
  const remote = sessionRemote();
  expect((await visitorBridge(local('session', { name: 'Avery', visitorId: 'operator' }), APPROVED_WORLD_SOURCE, remote)).status).toBe(400);
  expect((await visitorBridge(local('suggestions', { text: 'Build a useful public calendar', idempotencyKey: 'request-123', actor: 'steward' }), APPROVED_WORLD_SOURCE, remote)).status).toBe(400);
  expect((await visitorBridge(local('session', { name: 'Avery' }, { 'Content-Type': 'text/plain' }), APPROVED_WORLD_SOURCE, remote)).status).toBe(415);
  expect((await visitorBridge(local('session', { name: 'Avery' }, { 'Content-Length': '9000' }), APPROVED_WORLD_SOURCE, remote)).status).toBe(413);
  expect((await visitorBridge(local('session', { name: 'a'.repeat(9000) }), APPROVED_WORLD_SOURCE, remote)).status).toBe(413);
  expect(remote).not.toHaveBeenCalled();
});

it('forwards only strict suggestion input and returns public canonical suggestion data', async () => {
  const suggestion = { id: 'suggestion-1', visitorId: 'visitor-1', visitorName: 'Avery', text: 'Build a useful public calendar', createdAt: '2026-10-17T00:00:00.000Z', status: 'pending', votes: [] };
  const remote = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ suggestion }));
  const response = await visitorBridge(local('suggestions', { text: suggestion.text, idempotencyKey: 'request-123' }, { Cookie: `arti_live_visitor=${token}` }), APPROVED_WORLD_SOURCE, remote, 'suggestion-post');
  expect(await response.json()).toEqual({ suggestion });
  expect(remote.mock.calls[0][1]?.body).toBe(JSON.stringify({ text: suggestion.text, idempotencyKey: 'request-123' }));
});

it('never remaps operator, insecure, malformed or domain-scoped upstream cookies', async () => {
  for (const cookie of ['arti_session=operator; HttpOnly; Secure; SameSite=Lax; Path=/', `__Host-arti_visitor=${token}; HttpOnly; SameSite=Lax; Path=/`, `__Host-arti_visitor=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=example.com`]) {
    const remote = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ visitor: null }, { headers: { 'Set-Cookie': cookie } }));
    const response = await visitorBridge(new Request('http://localhost:5173/api/v1/visitor/session'), APPROVED_WORLD_SOURCE, remote);
    expect(response.headers.has('Set-Cookie')).toBe(false);
  }
});

it('bounds local session creation independently of caller-supplied IP headers', async () => {
  const remote = sessionRemote();

  for (let index = 0; index < 10; index++) expect((await visitorBridge(local('session', { name: 'Avery' }, { 'CF-Connecting-IP': String(index) }), APPROVED_WORLD_SOURCE, remote, 'rate-test')).status).toBe(200);
  expect((await visitorBridge(local('session', { name: 'Avery' }, { 'CF-Connecting-IP': 'new-ip' }), APPROVED_WORLD_SOURCE, remote, 'rate-test')).status).toBe(429);
  expect(remote).toHaveBeenCalledTimes(10);
});

it('fails closed on private/non-schema upstream responses and never substitutes simulated data', async () => {
  const remote = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ visitor: null, privateWorld: 'secret' }));
  const response = await visitorBridge(new Request('http://localhost:5173/api/v1/visitor/session'), APPROVED_WORLD_SOURCE, remote);
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('secret');
});
