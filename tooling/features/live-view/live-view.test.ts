import { describe, expect, it, vi } from 'vitest';
import { APPROVED_WORLD_SOURCE, liveViewResponse, validateWorldSource } from './live-view';

const local = (path: string, method = 'GET') => new Request(`http://localhost:5173${path}`, { method, headers: { authorization: 'Bearer private', cookie: 'session=private' } });

describe('console.live-public-mirror', () => {
  it('preserves simulation unless the approved source is explicitly configured', () => {
    expect(validateWorldSource(undefined)).toBeUndefined();
    expect(validateWorldSource(`${APPROVED_WORLD_SOURCE}/`)).toBe(APPROVED_WORLD_SOURCE);

    for (const source of ['http://arti-staging.apco-dir.workers.dev', 'https://example.com', `${APPROVED_WORLD_SOURCE}/private`, `${APPROVED_WORLD_SOURCE}?secret=x`, `https://user:password@arti-staging.apco-dir.workers.dev`]) {
      expect(() => validateWorldSource(source)).toThrow();
    }
  });

  it('retrieves only the fixed public world without forwarding credentials or response cookies', async () => {
    const remote = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ entities: [{ id: 'builder-1' }] }, { headers: { 'set-cookie': 'private=bad' } }));
    const response = await liveViewResponse(local('/api/v1/public'), APPROVED_WORLD_SOURCE, remote);
    expect(await response?.json()).toEqual({ entities: [{ id: 'builder-1' }] });
    expect(response?.headers.get('set-cookie')).toBeNull();
    expect(remote).toHaveBeenCalledWith(`${APPROVED_WORLD_SOURCE}/api/v1/public/world`, expect.objectContaining({ method: 'GET', headers: { accept: 'application/json' }, credentials: 'omit', redirect: 'error' }));
  });

  it('loads production entity domain from the public configuration', async () => {
    const remote = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ entityDomain: 'agents.eva-site.app' }));
    const response = await liveViewResponse(local('/api/v1/public/config'), APPROVED_WORLD_SOURCE, remote);
    expect(await response?.json()).toEqual({ entityDomain: 'agents.eva-site.app' });
  });

  it('blocks operator, session, MCP, unknown API, queries and every mutation locally', async () => {
    const remote = vi.fn<typeof fetch>();

    for (const [path, method] of [['/api/v1/session', 'GET'], ['/api/v1/world', 'GET'], ['/api/v1/commands', 'POST'], ['/api/v1/catalog', 'GET'], ['/mcp', 'POST'], ['/api/v1/public?target=https://example.com', 'GET'], ['/api/v1/public', 'POST']]) {
      expect((await liveViewResponse(local(path!, method), APPROVED_WORLD_SOURCE, remote))?.status).toBe(403);
    }

    expect(remote).not.toHaveBeenCalled();
  });

  it('reports upstream failure without substituting simulation', async () => {
    const remote = vi.fn<typeof fetch>().mockResolvedValue(new Response('login', { status: 302 }));
    const response = await liveViewResponse(local('/api/v1/public'), APPROVED_WORLD_SOURCE, remote);
    expect(response?.status).toBe(502);
    expect(await response?.json()).toEqual({ error: 'Cloudflare public world is unavailable. No simulated data was substituted.' });
  });

  it('redirects initial navigation to the public map and identifies its read-only health', async () => {
    const remote = vi.fn<typeof fetch>();
    expect((await liveViewResponse(local('/'), APPROVED_WORLD_SOURCE, remote))?.headers.get('location')).toBe('/world');
    expect(await (await liveViewResponse(local('/api/v1/health'), APPROVED_WORLD_SOURCE, remote))?.json()).toMatchObject({ mode: 'live-public-mirror', readOnly: false, visitorIntake: true });
    expect(await liveViewResponse(local('/src/main.tsx'), APPROVED_WORLD_SOURCE, remote)).toBeNull();
    expect(remote).not.toHaveBeenCalled();
  });
});


it('mirrors public build and rejects visitor mutations that lack a same-origin browser request', async () => {
  const remote = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ currentGoal: null }));
  expect((await liveViewResponse(local('/api/v1/visitor/suggestions', 'POST'), APPROVED_WORLD_SOURCE, remote))?.status).toBe(403);
  expect(remote).not.toHaveBeenCalled();
  expect(await (await liveViewResponse(local('/api/v1/public/build'), APPROVED_WORLD_SOURCE, remote))?.json()).toEqual({ currentGoal: null });
});
