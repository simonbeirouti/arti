/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { OperationsLedger } from '../../apps/world/features/operations/ledger';

it('deduplicates trusted traffic receipts and publishes no visitor identity or private state', async () => {
  const world = env.WORLD.getByName('analytics-world');
  await world.command({ role: 'operator' }, { type: 'goal.create', objective: 'PRIVATE_OBJECTIVE', criteria: ['private criterion'], constraints: [] }, 'private-goal');
  await world.recordTraffic('builder-1', 'unclassified', 200, 20, 'request-a');
  await world.recordTraffic('builder-1', 'unclassified', 200, 20, 'request-a');
  await world.recordTraffic('builder-1', 'synthetic', 500, 5, 'request-b');
  const analytics = await world.publicAnalytics();
  expect(analytics.reduce((total, item) => total + item.requests, 0)).toBe(2);
  expect(analytics.find(item => item.kind === 'synthetic')?.errors).toBe(1);
  expect(JSON.stringify(analytics)).not.toMatch(/PRIVATE_OBJECTIVE|request-a|private criterion/);
});

it('counts measured model tokens once per receipt and retains only counters in operations projection', async () => {
  const world = env.WORLD.getByName('usage-world');
  await world.recordModelUsage('researcher', 30, 10, 'usage-a');
  await world.recordModelUsage('researcher', 30, 10, 'usage-a');
  expect((await world.operations()).metrics.find(item => item.name === 'model.prompt_tokens')?.value).toBe(30);
  expect((await world.operations()).metrics.find(item => item.name === 'model.completion_tokens')?.value).toBe(10);
});

it('retains traffic aggregate while expiring receipt dedupe after a day', async () => {
  const world = env.WORLD.getByName('traffic-clock');

  const counts = await runInDurableObject(world, async (_instance, state) => {
    const ledger = new OperationsLedger(state.storage.sql);
    const receipt = { entityId: 'steward', kind: 'internal' as const, status: 200, elapsedMs: 1, requestId: 'local' };
    ledger.traffic(receipt, 0);
    ledger.traffic({ ...receipt, requestId: 'new' }, 2 * 86400000);

    return ledger.analytics();
  });

  expect(counts).toHaveLength(2);
});
