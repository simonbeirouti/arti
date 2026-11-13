import { releaseFingerprint } from '../../apps/world/generated/release';
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

it('rejects live activation without provisioned bindings and preserves simulation after configured allowances', async () => {
  const world = env.WORLD.getByName('activation-readiness');
  await world.command({ role: 'operator' }, { type: 'budget.configure', dailyUsd: 10 }, 'configure-activation-global');
  await world.command({ role: 'operator' }, { type: 'budget.entity.configure', entityId: 'researcher', dailyUsd: 1 }, 'configure-activation-entity');

  const rejected = await runInDurableObject(world, instance => {
    try { instance.activateLive(10, 'ENABLE_LIVE_WORLD', releaseFingerprint);

 return 'unexpected activation'; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  });

  expect(rejected).toContain('requires D1');
  const state = await world.inspect();
  expect(state.mode).toBe('simulation');
  expect(state.budget.dailyUsd).toBe(10);
  expect(state.entities.find(entity => entity.id === 'researcher')?.dailyAllowanceUsd).toBe(1);
});
