import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { startServers } from '../../server';

it('local GLM APIs report inference truthfully and require operator authentication plus trusted origin', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'arti-local-glm-http-'));
  const servers = await startServers(process.cwd(), folder, 0, { api: 0, knowledge: 0, siteStart: 0 }, { accountId: 'a'.repeat(32), dailyUsd: 1, activation: 'ENABLE_PAID_LOCAL_GLM' });

  try {
    const base = servers.apiUrl;
    expect(await (await fetch(`${base}/api/v1/health`)).json()).toMatchObject({ mode: 'simulation', paidActivity: true });
    expect((await fetch(`${base}/api/v1/local-glm/source`)).status).toBe(401);
    const session = await fetch(`${base}/api/v1/session`);
    const cookie = session.headers.get('set-cookie')!.split(';')[0];
    expect((await fetch(`${base}/api/v1/local-glm/retry`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://untrusted.example' } })).status).toBe(403);
    const tokens = JSON.parse(await readFile(join(folder, 'agent-tokens.json'), 'utf8'));
    expect((await fetch(`${base}/api/v1/local-glm/source`, { headers: { Authorization: `Bearer ${tokens['builder-1']}` } })).status).toBe(403);
    expect((await fetch(`${base}/api/v1/local-glm/retry`, { method: 'POST', headers: { Cookie: cookie } })).status).toBe(200);
    expect(servers.service.getState().budget.spentUsd).toBe(0);
  } finally { await servers.close(); await rm(folder, { recursive: true, force: true }); }
});
