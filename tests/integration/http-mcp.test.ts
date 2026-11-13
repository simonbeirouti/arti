import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { startServers } from '../../tooling/server';
import { createBackup } from '../../tooling/backup-library';

it('authenticates REST and MCP identities and never exposes operator goals through entity tools', async () => {
  const data = await mkdtemp(join(tmpdir(), 'arti-http-'));
  const running = await startServers(process.cwd(), data, 0, { api: 0, knowledge: 0, siteStart: 0 });
  const base = running.apiUrl;

  try {
    await expect(createBackup(data, join(data, 'unsafe-backup'))).rejects.toThrow('Stop the local server');
    expect((await fetch(`${base}/api/v1/world`)).status).toBe(401);
    expect((await fetch(`${base}/api/v1/session`, { headers: { Origin: 'https://hostile.invalid' } })).status).toBe(403);
    const session = await fetch(`${base}/api/v1/session`);
    const cookie = session.headers.get('set-cookie')?.split(';')[0] ?? '';
    const create = await fetch(`${base}/api/v1/commands`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'http-create-goal', command: { type: 'goal.create', objective: 'PRIVATE_HTTP_GOAL', criteria: ['A result'], constraints: [] } }) });
    expect(create.status).toBe(200);
    const tokens: Record<string, string> = JSON.parse(await readFile(join(data, 'agent-tokens.json'), 'utf8'));
    const headers = { Authorization: `Bearer ${tokens.researcher}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    const inspect = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'world.inspect', arguments: {} } }) });
    expect(inspect.status).toBe(200);
    const result = await inspect.text();
    expect(result).toContain('Atlas');
    expect(result).not.toContain('PRIVATE_HTTP_GOAL');
    expect((await fetch(`${base}/api/v1/world`, { headers })).status).toBe(403);
    const forged = await fetch(`${base}/api/v1/commands`, { method: 'POST', headers, body: JSON.stringify({ idempotencyKey: 'http-forged-goal', actor: { role: 'operator' }, command: { type: 'goal.create', objective: 'forged', criteria: ['result'], constraints: [] } }) });
    expect(forged.status).toBe(400);
    const humanPost = await fetch(`${base}/api/v1/commands`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'http-human-post', command: { type: 'social.post', body: 'forbidden human post' } }) });
    expect(humanPost.status).toBe(403);
  } finally { await running.close(); await rm(data, { recursive: true, force: true }); }
}, 15000);
