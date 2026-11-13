/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { createInitialState } from '../../packages/domain/src/index';

it('atomically gates public generated messages and deduplicates the original delivery key', async () => {
  const world = env.WORLD.getByName('shared-conversation-guard');

  const result = await runInDurableObject(world, (instance, state) => {
    const initial = createInitialState(); initial.mode = 'live';
    state.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_snapshot(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL)');
    state.storage.sql.exec('INSERT INTO world_snapshot VALUES(1,?)', JSON.stringify(initial));
    const command = { type: 'social.post' as const, body: 'I suggest checking one public source before building the chooser.' };
    instance.conversation('researcher', command, 'conversation-original-delivery');
    instance.conversation('researcher', command, 'conversation-original-delivery');
    const posted = instance.publicState().discussions;
    instance.command({ role: 'operator' }, { type: 'world.pause', paused: true }, 'pause-conversation-world');
    let paused = false;

    try { instance.conversation('builder-1', command, 'conversation-paused-delivery'); } catch { paused = true; }

    instance.command({ role: 'operator' }, { type: 'world.pause', paused: false }, 'resume-conversation-world');
    instance.command({ role: 'operator' }, { type: 'goal.create', objective: 'PRIVATE shared question material', criteria: ['Check a saved public result'], constraints: [] }, 'create-conversation-private-goal');
    let privateGoal = false;

    try { instance.conversation('builder-1', command, 'conversation-private-delivery'); } catch { privateGoal = true; }

    return { posted, paused, privateGoal, count: instance.publicState().discussions.length };
  });

  expect(result.posted).toHaveLength(1);
  expect(result.posted[0]).toMatchObject({ entityId: 'researcher', origin: 'agent' });
  expect(result.paused).toBe(true); expect(result.privateGoal).toBe(true); expect(result.count).toBe(1);
});

it('serializes project publication across contributors and rejects personal publication', async () => {
  const world = env.WORLD.getByName('shared-publication-lock');

  const result = await runInDurableObject(world, (instance, storage) => {
    const initial = createInitialState(); initial.mode = 'live';
    storage.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_snapshot(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL)');
    storage.storage.sql.exec('INSERT INTO world_snapshot VALUES(1,?)', JSON.stringify(initial));
    const first = instance.acquirePublication('builder-1', 'workflow-first', 'collective');
    const conflict = instance.acquirePublication('builder-2', 'workflow-other', 'collective');
    instance.authorizePublication('builder-1', null, undefined, undefined, 'workflow-first', 'collective');
    let personal = false;

    try { instance.authorizePublication('builder-1', null); } catch { personal = true; }

    instance.releasePublication('builder-1', 'workflow-first', 'collective');
    const next = instance.acquirePublication('builder-2', 'workflow-other', 'collective');

    return { first, conflict, personal, next };
  });

  expect(result).toEqual({ first: true, conflict: false, personal: true, next: true });
});
