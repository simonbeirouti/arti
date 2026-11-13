import { z } from 'zod';

export const serviceManifestSchema = z.object({ jobs: z.array(z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/), intervalMinutes: z.number().int().min(5).max(1440), path: z.string().regex(/^\/_arti\/jobs\/[a-z0-9_-]+$/) }).strict()).max(10) }).strict().superRefine((manifest, ctx) => {
  const ids = new Set<string>();

  for (const job of manifest.jobs) {
    if (ids.has(job.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate job id' });
    ids.add(job.id);
  }
});

export type ServiceManifest = z.infer<typeof serviceManifestSchema>;

export function dueJobs(manifest: ServiceManifest, scheduledAt: number): ServiceManifest['jobs'] {
  const minute = Math.floor(scheduledAt / 60_000);

  return manifest.jobs.filter(job => minute % job.intervalMinutes === 0);
}
