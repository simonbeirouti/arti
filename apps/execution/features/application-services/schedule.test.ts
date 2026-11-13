import { expect, it } from 'vitest';
import { createInitialState } from '../../../../packages/domain/src/index';
import { runScheduledJobs, type ScheduledEnvironment } from './schedule';

it('scopes scheduled dispatch to active immutable code and app data, suppresses duplicate ticks and paused work', async () => {
  const state = createInitialState();
  state.mode = 'live';
  state.projects = [];
  state.deployments.push({ id: 'published', entityId: 'builder-1', commit: 'a'.repeat(40), bundleHash: 'b'.repeat(64), workerName: `builder-1-${'b'.repeat(64)}`, createdAt: state.clock, version: 1, environment: 'production', status: 'published' });
  const claims = new Set<string>();
  const calls: { worker: string; jobId?: string; dataValue?: string | null }[] = [];
  const data = { get: async () => 'builder-1-record', put: async () => {}, delete: async () => {} };
  let reservations = 0;
  const charges: (number | null)[] = [];

  const environment: ScheduledEnvironment = {
    LIVE_ACTIVATED: 'true', DAILY_ALLOWANCE_USD: '1',
    WORLD: { getByName: () => ({ inspect: async () => state, reserve: async () => ({ id: `reservation-${++reservations}` }), settle: async (_id, actual) => { charges.push(actual); }, recordTraffic: async () => {} }) },
    BUILDS: { get: async () => ({ size: 100, json: async () => ({ jobs: [{ id: 'refresh', intervalMinutes: 5, path: '/_arti/jobs/refresh' }] }) }), put: async () => null },
    DISPATCH: { get: (worker, args) => ({ async fetch(request) { expect(request.method).toBe('POST'); calls.push({ worker, jobId: args?.props.job?.id, dataValue: await args?.props.APP_DATA.get('count') });

 return new Response('Done'); } }) },
  };

  const stores = () => ({ async claimJob(key: string) { if (claims.has(key)) return false; claims.add(key);

 return true; } });

  await runScheduledJobs(environment, 300_000, () => data, stores);
  await runScheduledJobs(environment, 300_000, () => data, stores);
  expect(charges).toEqual([null, 0]);
  expect(calls).toEqual([{ worker: `builder-1-${'b'.repeat(64)}`, jobId: 'refresh', dataValue: 'builder-1-record' }]);
  state.projects = createInitialState().projects;
  await runScheduledJobs(environment, 600_000, () => data, stores);
  expect(calls).toHaveLength(1);
  expect(charges).toEqual([null, 0]);
  state.projects = [];
  state.paused = true;
  await runScheduledJobs(environment, 600_000, () => data, stores);
  expect(calls).toHaveLength(1);
  environment.LIVE_ACTIVATED = 'false';
  state.paused = false;
  await runScheduledJobs(environment, 900_000, () => data, stores);
  expect(calls).toHaveLength(1);
});
