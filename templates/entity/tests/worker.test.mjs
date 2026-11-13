import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './output/worker.js';

test('serves an authored public presence', async () => {
  const response = await worker.fetch(new Request('https://entity.invalid/'));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /My public presence/);
});

test('scheduled jobs require a trusted capability and persist through application storage', async () => {
  const records = new Map();
  const request = new Request('https://entity.invalid/_arti/jobs/refresh', { method: 'POST' });
  assert.equal((await worker.fetch(request)).status, 403);
  const APP_DATA = { get: async key => records.get(key) ?? null, put: async (key, value) => { records.set(key, value); }, delete: async key => { records.delete(key); } };
  assert.equal((await worker.fetch(request, undefined, { props: { APP_DATA, job: { id: 'refresh', scheduledAt: 1800000 } } })).status, 200);
  const status = await worker.fetch(new Request('https://entity.invalid/api/status'), undefined, { props: { APP_DATA } });
  assert.deepEqual(await status.json(), { lastRefresh: '1800000' });
});
