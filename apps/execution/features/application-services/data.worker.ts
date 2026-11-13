/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { ApplicationStore, ScopedApplicationData } from './data';

declare global {
  namespace Cloudflare {
    interface Env { APP_DATA?: DurableObjectNamespace<ApplicationStore> }
  }
}

async function captureFailure(store: DurableObjectStub<ApplicationStore>, action: (instance: ApplicationStore) => Promise<void>): Promise<string> {
  return runInDurableObject(store, async instance => {
    try { await action(instance);

      return 'unexpected success'; } catch (error) { return error instanceof Error ? error.message : String(error); }
  });
}

it('keeps entity app data isolated and durable without exposing scheduler or namespace authority', async () => {
  if (!env.APP_DATA) throw new Error('Missing application namespace');
  const first = env.APP_DATA.getByName('first');
  const second = env.APP_DATA.getByName('second');
  const capability = new ScopedApplicationData(first);
  await capability.put('counter', '1');
  expect(await second.get('counter')).toBeNull();
  await evictDurableObject(first);
  expect(await capability.get('counter')).toBe('1');
  await expect(capability.put('../second/private', 'leak')).rejects.toThrow();
  await expect(capability.put('large', 'x'.repeat(32_001))).rejects.toThrow();
  expect('claimJob' in capability).toBe(false);
  expect('store' in capability).toBe(false);
  expect(await first.claimJob('v1:refresh:1')).toBe(true);
  expect(await first.claimJob('v1:refresh:1')).toBe(false);
  await capability.delete('counter');
  expect(await capability.get('counter')).toBeNull();
});

it('enforces app record allowance transactionally under concurrent puts', async () => {
  if (!env.APP_DATA) throw new Error('Missing application namespace');
  const store = env.APP_DATA.getByName('quota');

  for (let index = 0; index < 999; index++) await store.put(`key${index}`, 'v');
  const results = await runInDurableObject(store, async instance => (await Promise.allSettled([instance.put('last-a', 'a'), instance.put('last-b', 'b')])).map(result => result.status));
  expect(results.filter(status => status === 'fulfilled')).toHaveLength(1);
  await store.put('key0', 'updated');
  expect(await store.get('key0')).toBe('updated');
});

it('freezes app writes during backup and restores app records plus job claims from checksummed R2', async () => {
  if (!env.APP_DATA) throw new Error('Missing application namespace');
  const store = env.APP_DATA.getByName('backup-entity');
  await store.put('saved', 'before');
  expect(await store.claimJob('v1:refresh:1')).toBe(true);
  const snapshot = await store.exportSnapshot('backup-entity', 'backup-test');
  expect(snapshot.sha256).toHaveLength(64);
  expect(await captureFailure(store, instance => instance.put('saved', 'during-freeze'))).toContain('freeze');
  await store.releaseFreeze();
  await store.put('saved', 'after');
  const retried = await store.exportSnapshot('backup-entity', 'backup-test');
  expect(retried).toEqual(snapshot);
  await store.releaseFreeze();
  expect(await captureFailure(store, instance => instance.restoreSnapshot(snapshot.key, 'f'.repeat(64)))).toContain('checksum');
  expect(await store.get('saved')).toBe('after');
  await store.restoreSnapshot(snapshot.key, snapshot.sha256);
  expect(await store.get('saved')).toBe('before');
  expect(await captureFailure(store, instance => instance.put('saved', 'still-frozen'))).toContain('freeze');
  await store.releaseFreeze();
  expect(await store.claimJob('v1:refresh:1')).toBe(false);
});

it('passes an entity-scoped loopback connector through real service props', async () => {
  if (!env.APP_DATA) throw new Error('Missing application namespace');
  const response = await SELF.fetch('https://fixture.invalid/connector');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ value: 'persisted' });
  expect(await env.APP_DATA.getByName('connector-first').get('connector-probe')).toBe('persisted');
  expect(await env.APP_DATA.getByName('connector-second').get('connector-probe')).toBeNull();
});
