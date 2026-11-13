import { expect, it } from 'vitest';
import worker from './index';

it('exposes slim public entrypoints and exact preview CSP without operator credentials', async () => {
  const requests: Request[] = [];

  const environment = { ASSETS: { fetch: async () => new Response('knowledge') }, WORLD: { fetch: async (request: Request) => {
    requests.push(request);

    return request.url.endsWith('/api/v1/public/world') ? Response.json({ projects: [{ hostname: 'project.preview.example' }, { hostname: 'evil.example; script-src *' }] }) : new Response('world', { headers: { 'Set-Cookie': 'unsafe' } });
  } } };

  for (const path of ['/world', '/showcase', '/assets/game.js', '/api/v1/public/build']) {
    const response = await worker.fetch(new Request(`https://public.example${path}`, { headers: { Authorization: 'secret', Cookie: 'private', 'Cf-Access-Jwt-Assertion': 'private' } }), environment);
    expect(await response.text()).toBe('world');
    expect(response.headers.has('Set-Cookie')).toBe(false);

    if (['/world', '/showcase'].includes(path)) expect(response.headers.get('Content-Security-Policy')).toContain('frame-src https://project.preview.example;');
  }

  expect(requests.every(request => !request.headers.has('Authorization') && !request.headers.has('Cookie') && !request.headers.has('Cf-Access-Jwt-Assertion'))).toBe(true);
  expect((await worker.fetch(new Request('https://public.example/api/v1/world'), environment)).status).toBe(404);
  expect((await worker.fetch(new Request('https://public.example/api/v1/commands', { method: 'POST' }), environment)).status).toBe(405);
});

it('forwards only scoped visitor cookies and mutation metadata and preserves only session cookie', async () => {
  const requests: Request[] = [];
  const token = 'a'.repeat(64);

  const environment = { ASSETS: { fetch: async () => new Response('knowledge') }, WORLD: { fetch: async (request: Request) => {
    requests.push(request);
    const headers = new Headers();
    headers.append('Set-Cookie', `__Host-arti_visitor=${token}; HttpOnly; Secure; SameSite=Lax; Path=/`);
    headers.append('Set-Cookie', 'arti_session=operator; HttpOnly; Path=/');

    return Response.json({ visitor: { id: 'visitor-1', name: 'Avery' } }, { headers });
  } } };

  const response = await worker.fetch(new Request('https://public.example/api/v1/visitor/session', { method: 'POST', headers: { Origin: 'https://public.example', 'Content-Type': 'application/json', Cookie: `arti_session=operator; __Host-arti_visitor=${token}`, Authorization: 'secret', 'Cf-Access-Jwt-Assertion': 'private', 'CF-Connecting-IP': 'forged' }, body: JSON.stringify({ name: 'Avery' }) }), environment);
  const request = requests[0];
  expect(request.headers.get('Cookie')).toBe(`__Host-arti_visitor=${token}`);
  expect(request.headers.get('Origin')).toBe('https://public.example');
  expect(request.headers.has('Authorization')).toBe(false);
  expect(request.headers.has('CF-Connecting-IP')).toBe(false);
  expect(await request.json()).toEqual({ name: 'Avery' });
  expect(response.headers.getSetCookie()).toEqual([`__Host-arti_visitor=${token}; HttpOnly; Secure; SameSite=Lax; Path=/`]);
});

it('redirects the public landing page into the slim public route and preserves standalone knowledge', async () => {
  const assets = { fetch: async () => new Response('knowledge') };
  const world = { fetch: async () => new Response('operator app') };
  const response = await worker.fetch(new Request('https://public.example/'), { ASSETS: assets, WORLD: world, PUBLIC_WORLD_HOME: 'true' });
  expect(response.status).toBe(302);
  expect(response.headers.get('Location')).toBe('/world');
  expect(await (await worker.fetch(new Request('https://public.example/'), { ASSETS: assets, WORLD: world })).text()).toBe('knowledge');
});
