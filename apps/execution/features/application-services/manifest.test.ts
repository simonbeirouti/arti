import { expect, it } from 'vitest';
import { dueJobs, serviceManifestSchema } from './manifest';

it('bounds generated schedules and accepts only platform-reserved local job routes', () => {
  const manifest = serviceManifestSchema.parse({ jobs: [{ id: 'refresh', intervalMinutes: 15, path: '/_arti/jobs/refresh' }] });
  expect(dueJobs(manifest, 15 * 60_000)).toHaveLength(1);
  expect(dueJobs(manifest, 16 * 60_000)).toHaveLength(0);
  expect(serviceManifestSchema.safeParse({ jobs: [{ id: 'refresh', intervalMinutes: 1, path: 'https://evil.example/' }] }).success).toBe(false);
  expect(serviceManifestSchema.safeParse({ jobs: [...manifest.jobs, ...manifest.jobs] }).success).toBe(false);
});
