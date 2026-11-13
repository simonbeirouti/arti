import { backupCheckpointSchema } from '../../apps/world/features/operations/backup';
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { getAgentByName } from 'agents';
import { runInDurableObject, reset, abortAllDurableObjects } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import type { EntityAgent } from '../../apps/agent-runtime/src/worker';

declare global {
  namespace Cloudflare {
    interface Env { ENTITY_AGENT?: DurableObjectNamespace<EntityAgent>; WORLD_BACKUPS?: R2Bucket }
  }
}

beforeEach(async () => {
  await reset();
  await abortAllDurableObjects();

  if (env.WORLD_BACKUPS) {
    const objects = await env.WORLD_BACKUPS.list();
    await Promise.all(objects.objects.map(object => env.WORLD_BACKUPS!.delete(object.key)));
  }
});

it('backs up and restores every private memory with a paused consistent world in real storage', async () => {
  if (!env.ENTITY_AGENT || !env.WORLD_BACKUPS) throw new Error('Test bindings required');
  const world = env.WORLD.getByName('arti-world');
  const agent = await getAgentByName(env.ENTITY_AGENT, 'researcher');
  await agent.remember('research', 'PRIVATE_MEMORY_SAVED');

  const population = (await world.inspect()).entities.length;

  for (let index = 0; index <= population; index += 1) expect(await world.backup(1791792000000)).toBe(index < population ? 'pending' : 'completed');
  expect((await world.inspect()).paused).toBe(false);
  const list = await env.WORLD_BACKUPS.list({ prefix: 'world/' });
  expect(list.objects).toHaveLength(1);
  const object = await env.WORLD_BACKUPS.get(list.objects[0].key);
  expect(object).not.toBeNull();

  if (!object) throw new Error('Expected complete backup');
  const source = await object.text();
  expect(JSON.parse(source).schemaVersion).toBe(2);
  await agent.remember('research', 'PRIVATE_MEMORY_CHANGED');
  await world.command({ role: 'operator' }, { type: 'world.pause', paused: true }, 'restore-pause');
  const corrupted = JSON.parse(source);
  corrupted.entities[0].payload.state.entries.push('corrupt');
  const before = await world.inspect();

  const denied = await runInDurableObject(world, async instance => {
    try { await instance.restoreCompleteBackup(JSON.stringify(corrupted));

 return false; } catch { return true; }
  });

  expect(denied).toBe(true);
  expect(await world.inspect()).toEqual(before);
  expect((await agent.readMemory()).entries).toContain('memory:research:PRIVATE_MEMORY_CHANGED');

  const wrongIdentity = await runInDurableObject(agent, async instance => {
    const snapshot = await instance.exportPrivateState();
    snapshot.entityId = 'builder-1';

    try { await instance.importPrivateState(snapshot);

 return false; } catch { return true; }
  });

  expect(wrongIdentity).toBe(true);
  await world.restoreCompleteBackup(source);
  expect((await world.inspect()).paused).toBe(true);
  expect((await agent.readMemory()).entries).toContain('memory:research:PRIVATE_MEMORY_SAVED');
  expect(JSON.stringify(await world.publicState())).not.toContain('PRIVATE_MEMORY');
});

it('reports a failed live backup while preserving the paused barrier and excluding a partial manifest', async () => {
  if (!env.WORLD_BACKUPS) throw new Error('Test backup binding required');
  const world = env.WORLD.getByName('arti-world');
  await runInDurableObject(world, (instance, context) => {
    const state = instance.inspect();
    state.mode = 'live'; state.paused = true;
    state.projects![0].siteVersion = 1;
    context.storage.sql.exec('INSERT INTO world_snapshot(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify(state));
  });

  const population = (await world.inspect()).entities.length;

  for (let index = 0; index < population; index += 1) expect(await world.backup(1791878400000)).toBe('pending');

  const rejected = await runInDurableObject(world, async instance => {
    try { await instance.backup(1791878400000);

 return false; } catch { return true; }
  });

  expect(rejected).toBe(true);
  expect((await world.inspect()).paused).toBe(true);
  expect((await world.operations()).recoveryBarrier).toBe('1791878400000');
  expect((await world.operations()).metrics.find(item => item.name === 'backup.failure')?.value).toBe(1);
  expect(await env.WORLD_BACKUPS.get('world/2026-10-13/1791878400000.json')).toBeNull();
  const checkpoint = backupCheckpointSchema.parse(await runInDurableObject(world, async (_instance, context) => context.storage.get('backup-progress:1791878400000')));
  expect(checkpoint.rows).toHaveLength(population);
});

it('resumes one private entity checkpoint per invocation across DO restart and day rollover', async () => {

  if (!env.ENTITY_AGENT || !env.WORLD_BACKUPS) throw new Error('Test bindings required');
  const world = env.WORLD.getByName('arti-world');
  const time = 1791849636000;
  const id = String(time);
  const expectedIds = (await world.inspect()).entities.map(entity => entity.id);
  expect(await world.backup(time)).toBe('pending');
  expect((await world.inspect()).paused).toBe(true);
  const first = await runInDurableObject(world, async (_instance, context) => context.storage.get(`backup-progress:${id}`));
  const parsed = backupCheckpointSchema.parse(first);
  expect(parsed.rows.map(row => row.entityId)).toEqual(expectedIds.slice(0, 1));
  expect((await env.WORLD_BACKUPS.list({ prefix: 'world/' })).objects).toHaveLength(0);
  await abortAllDurableObjects();

  for (let index = 1; index <= expectedIds.length; index += 1) {
    const resumed = env.WORLD.getByName('arti-world');
    expect(await resumed.backup(time + 86400000)).toBe(index < expectedIds.length ? 'pending' : 'completed');

    if (index < expectedIds.length) {
      const checkpoint = await runInDurableObject(resumed, async (_instance, context) => context.storage.get(`backup-progress:${id}`));
      expect(backupCheckpointSchema.parse(checkpoint).rows.map(row => row.entityId)).toEqual(expectedIds.slice(0, index + 1));
    }
  }

  const key = `world/${new Date(time).toISOString().slice(0, 10)}/${id}.json`;
  const manifest = await env.WORLD_BACKUPS.get(key);

  if (!manifest) throw new Error('Expected complete original-day manifest');
  expect(JSON.parse(await manifest.text()).createdAt).toBe(new Date(time).toISOString());
  const finished = env.WORLD.getByName('arti-world');
  expect((await finished.operations()).recoveryBarrier).toBeNull();
  expect(await runInDurableObject(finished, async (_instance, context) => context.storage.get(`backup-progress:${id}`))).toBeUndefined();
});

it('rejects corrupt duplicate or mismatched checkpoints without publishing or clearing its barrier', async () => {
  if (!env.WORLD_BACKUPS) throw new Error('Test bindings required');
  const world = env.WORLD.getByName('arti-world');
  const time = 1791849636000;
  const key = `backup-progress:${time}`;
  expect(await world.backup(time)).toBe('pending');
  const saved = backupCheckpointSchema.parse(await runInDurableObject(world, async (_instance, context) => context.storage.get(key)));

  for (const corrupt of [
    { ...saved, rows: [saved.rows[0], saved.rows[0]] },
    { ...saved, id: '1' },
    { ...saved, environment: 'other' },
    { ...saved, rows: [{ ...saved.rows[0], sha256: 'f'.repeat(64) }] },
  ]) {
    await runInDurableObject(world, async (_instance, context) => { await context.storage.put(key, corrupt); });

    const rejected = await runInDurableObject(world, async instance => {
      try { await instance.backup(time);

 return false; } catch { return true; }
    });

    expect(rejected).toBe(true);
    expect((await world.inspect()).paused).toBe(true);
    expect((await world.operations()).recoveryBarrier).toBe(String(time));
    expect((await env.WORLD_BACKUPS.list({ prefix: 'world/' })).objects).toHaveLength(0);
  }

  await runInDurableObject(world, async (_instance, context) => { await context.storage.put(key, saved); });
  expect(await world.backup(time)).toBe('pending');
  const continued = backupCheckpointSchema.parse(await runInDurableObject(world, async (_instance, context) => context.storage.get(key)));
  expect(continued.rows).toHaveLength(2);
});

it('keeps checkpoint metadata small for a legal private population exceeding the DO value limit', async () => {
  if (!env.ENTITY_AGENT || !env.WORLD_BACKUPS) throw new Error('Test bindings required');
  const world = env.WORLD.getByName('arti-world');
  await world.command({ role: 'operator' }, { type: 'world.pause', paused: true }, 'large-backup-pause');
  const time = 1791849636000;
  const entities = (await world.inspect()).entities;
  const entries = Array(50).fill('x'.repeat(10000));

  for (const entity of entities) {
    const agent = await getAgentByName(env.ENTITY_AGENT, entity.id);
    await agent.importPrivateState({ entityId: entity.id, state: { entries, running: false, turns: 0, leaseUntil: 0, checkpoint: 0, turnId: null, pendingCommand: null, continuation: null } });
  }

  for (let index = 0; index <= entities.length; index += 1) {
    expect(await world.backup(time)).toBe(index < entities.length ? 'pending' : 'completed');

    if (index < entities.length) {
      const header = backupCheckpointSchema.parse(await runInDurableObject(world, async (_instance, context) => context.storage.get(`backup-progress:${time}`)));
      expect(new TextEncoder().encode(JSON.stringify(header)).byteLength).toBeLessThan(4096);
      expect(header.rows).toHaveLength(index + 1);
      const object = await env.WORLD_BACKUPS.get(header.rows[index].key);

      if (!object) throw new Error('Expected private R2 row');
      expect(object.size).toBeGreaterThan(500000);
    }
  }

  const manifest = await env.WORLD_BACKUPS.get(`world/${new Date(time).toISOString().slice(0, 10)}/${time}.json`);

  if (!manifest) throw new Error('Expected large complete manifest');
  expect(manifest.size).toBeGreaterThan(2 * 1024 * 1024);
  expect(JSON.parse(await manifest.text()).entities).toHaveLength(entities.length);
  expect(JSON.stringify(await world.publicState())).not.toContain('xxxxx');
});
