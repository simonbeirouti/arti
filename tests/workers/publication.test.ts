/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { WorldDurableObject } from '../../apps/world/src/index';

declare global {
  namespace Cloudflare {
    interface Env { WORLD: DurableObjectNamespace<WorldDurableObject> }
  }
}

it('serializes per-entity publication and permits at most two active execution leases', async () => {
  const world = env.WORLD.getByName('publication-concurrency');
  await runInDurableObject(world, (instance, context) => {
    const fixture = instance.inspect(); fixture.mode = 'live';
    context.storage.sql.exec('INSERT INTO world_snapshot(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify(fixture));
  });
  expect(await world.acquirePublication('builder-1', 'workflow-builder-one')).toBe(true);
  expect(await world.acquirePublication('builder-2', 'workflow-builder-two')).toBe(true);
  expect(await world.acquirePublication('researcher', 'workflow-researcher')).toBe(false);
  expect(await world.acquirePublication('builder-1', 'workflow-builder-one')).toBe(true);
  expect(await world.acquirePublication('builder-1', 'workflow-competing')).toBe(false);
  await world.releasePublication('builder-1', 'workflow-builder-one');
  expect(await world.acquirePublication('researcher', 'workflow-researcher')).toBe(true);
});
