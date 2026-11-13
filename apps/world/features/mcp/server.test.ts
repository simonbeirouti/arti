import { expect, it } from 'vitest';
import { authenticateMcpEntity, handleRemoteMcp } from './server';

const token = 'agent_'.padEnd(48, 'a');

const hash = async (value: string) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');

it('derives exactly one entity from the credential and ignores forged identity headers', async () => {
  const request = new Request('https://operator.example/api/v1/mcp', { headers: { Authorization: `Bearer ${token}`, 'X-Actor-Role': 'operator', 'X-Entity-Id': 'moderator' } });
  expect(await authenticateMcpEntity(request, JSON.stringify({ 'builder-1': await hash(token) }))).toEqual({ role: 'entity', entityId: 'builder-1' });
  expect(await authenticateMcpEntity(request, JSON.stringify({ 'builder-1': await hash(token), moderator: await hash(token) }))).toBeNull();
  expect(await authenticateMcpEntity(request, JSON.stringify({ moderator: '0'.repeat(64) }))).toBeNull();
});

it('rejects cross-origin requests before reaching private authority', async () => {
  const request = new Request('https://operator.example/api/v1/mcp', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' });
  const response = await handleRemoteMcp(request, { OPERATOR_ORIGIN: 'https://operator.example', WORLD: { getByName: () => { throw new Error('Must not access authority'); } } });
  expect(response.status).toBe(403);
});

it('serves entity MCP tools through the actual transport without leaking private world state', async () => {
  const { WorldEngine } = await import('../../../../packages/domain/src/index');
  const engine = new WorldEngine();
  engine.dispatch({ role: 'operator' }, { type: 'goal.create', objective: 'PRIVATE operator objective', criteria: ['Useful output'], constraints: [] }, 'private-mcp-goal');
  const actors: string[] = [];

  const environment = {
    OPERATOR_ORIGIN: 'https://operator.example', ENTITY_MCP_TOKEN_HASHES: JSON.stringify({ 'builder-1': await hash(token) }),
    WORLD: { getByName: () => ({ inspect: async () => engine.getState(), publicState: async () => engine.getPublicState(), ownTask: async () => null, command: async (actor: import('../../../../packages/contracts/src/index').Actor, command: import('../../../../packages/contracts/src/index').Command, key: string) => { actors.push(actor.entityId ?? actor.role);

 return engine.dispatch(actor, command, key); } }) },
  };

  const invoke = (name: string, args: Record<string, string>) => handleRemoteMcp(new Request('https://operator.example/api/v1/mcp', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'X-Actor-Role': 'operator' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), environment);

  const inspected = await invoke('world.inspect', {});
  expect(inspected.status).toBe(200);
  expect(await inspected.text()).not.toContain('PRIVATE');
  const assignment = await invoke('task.inspect', {});
  expect(await assignment.text()).not.toContain('PRIVATE');

  const posted = await handleRemoteMcp(new Request('https://operator.example/api/v1/mcp', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'world.command', arguments: { command: { type: 'social.post', body: 'Hello world' }, idempotencyKey: 'scoped-mcp-post' } } }),
  }), environment);

  expect(posted.status).toBe(200);
  expect(await posted.text()).toContain('public-safe authoring session');
  expect(actors).toEqual([]);
  expect(engine.getState().discussions).toEqual([]);
});
