/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { runInDurableObject, reset, abortAllDurableObjects } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import { ApplicationStore } from '../../apps/execution/features/application-services/data';

declare global {
  namespace Cloudflare { interface Env { APP_DATA?: DurableObjectNamespace<ApplicationStore> } }
}

beforeEach(async () => { await reset(); await abortAllDurableObjects(); });

it('freezes generated writes and restores entity application records plus scheduled job claims', async () => {
  if (!env.APP_DATA) throw new Error('Application store test binding missing');
  const world = env.WORLD.getByName('arti-world');
  const state = await world.inspect(); state.mode = 'live'; state.paused = true; state.budget.dailyUsd = 1;
  state.projects![0].siteVersion = 1;

  for (const entity of state.entities) entity.dailyAllowanceUsd = 1;
  await runInDurableObject(world, (_instance, storage) => {
    storage.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_snapshot(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
    storage.storage.sql.exec('INSERT INTO world_snapshot(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify({ ...state, paused: false }));
  });
  const store = env.APP_DATA.getByName('collective');
  await store.put('saved', 'original');
  expect(await store.claimJob('first-job')).toBe(true);
  await runInDurableObject(world, (_instance, context) => {
    context.storage.sql.exec('UPDATE world_snapshot SET value=? WHERE id=1', JSON.stringify(state));
    context.storage.sql.exec('CREATE TABLE IF NOT EXISTS backup_barrier(id INTEGER PRIMARY KEY,backup TEXT NOT NULL,resume INTEGER NOT NULL)');
    context.storage.sql.exec('INSERT INTO backup_barrier(id,backup,resume) VALUES(1,?,0)', '123');
  });
  const exported = await store.exportSnapshot('collective', '123');

  const frozen = await runInDurableObject(store, async instance => {
    try { await instance.put('saved', 'forbidden');

 return false; } catch { return true; }
  });

  expect(frozen).toBe(true);
  await runInDurableObject(world, (_instance, context) => {
    context.storage.sql.exec('DELETE FROM backup_barrier WHERE id=1');
    const current = JSON.parse(context.storage.sql.exec<{ value: string }>('SELECT value FROM world_snapshot WHERE id=1').one().value);
    current.paused = false;
    context.storage.sql.exec('UPDATE world_snapshot SET value=? WHERE id=1', JSON.stringify(current));
  });
  await store.releaseFreeze(); await store.put('saved', 'changed');
  await store.restoreSnapshot(exported.key, exported.sha256);
  expect(await store.get('saved')).toBe('original');
  await store.releaseFreeze();
  expect(await store.claimJob('first-job')).toBe(false);
});
