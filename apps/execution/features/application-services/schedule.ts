import { publicationEnabled, type PublicationConfiguration } from '../publication/gate';
import type { Deployment, WorldState } from '../../../../packages/contracts/src/index';
import { LiveGate } from '../../../../packages/provider-adapters/src/cloudflare';
import { dueJobs, serviceManifestSchema, type ServiceManifest } from './manifest';
import type { ApplicationDataApi } from './data';
import type { DispatchBinding } from '../publication/dispatch';

export interface ScheduledEnvironment extends PublicationConfiguration {
  LIVE_ACTIVATED: string;
  DAILY_ALLOWANCE_USD: string;
  DISPATCH: DispatchBinding;
  BUILDS: { get(key: string): Promise<{ size: number; json(): Promise<ServiceManifest> } | null>; put(key: string, content: string): Promise<R2Object | null> };
  WORLD: { getByName(name: string): {
    inspect(): Promise<WorldState>;
    reserve(entityId: string, estimatedUsd: number, operation: string): Promise<{ id: string }>;
    settle(id: string, actual: number | null): Promise<void>;
    recordTraffic(entityId: string, kind: 'unclassified' | 'internal' | 'synthetic', status: number, elapsedMs: number, requestId: string): Promise<void>;
  } };
}

export interface ScheduledStore { claimJob(key: string): Promise<boolean> }

export async function runScheduledJobs(environment: ScheduledEnvironment, scheduledAt: number, data: (entityId: string) => ApplicationDataApi, stores: (entityId: string) => ScheduledStore): Promise<void> {
  if (!publicationEnabled(environment)) return;

  if (environment.LIVE_ACTIVATED !== 'true' || !(Number(environment.DAILY_ALLOWANCE_USD) > 0)) return;
  const world = environment.WORLD.getByName('arti-world');
  const state = await world.inspect();

  if (state.mode !== 'live' || state.paused) return;
  const gate = new LiveGate({ activated: true, dailyAllowanceUsd: Number(environment.DAILY_ALLOWANCE_USD) }, world);
  const latest = new Map<string, Deployment>();

  for (const deployment of state.deployments) if (deployment.environment === 'production') latest.set(deployment.projectId ?? deployment.entityId, deployment);

  for (const deployment of latest.values()) {
    if (state.projects?.length && !deployment.projectId) continue;
    const targetId = deployment.projectId ?? deployment.entityId;

    if (deployment.workerName !== `${targetId.slice(0, 15)}-${deployment.bundleHash}`) continue;
    const stored = await environment.BUILDS.get(`manifests/${deployment.id}.json`);

    if (!stored || stored.size > 10_000) continue;
    const manifest = serviceManifestSchema.parse(await stored.json());

    for (const job of dueJobs(manifest, scheduledAt)) {
      const tick = Math.floor(scheduledAt / (job.intervalMinutes * 60_000));
      const key = `${deployment.version}:${job.id}:${tick}`;
      await gate.run(deployment.entityId, 0.001, 'application.job', async () => {
        const current = await world.inspect();

        if (current.paused || current.mode !== 'live' || current.deployments.findLast(item => deployment.projectId ? item.projectId === deployment.projectId : item.entityId === deployment.entityId && !item.projectId)?.id !== deployment.id) return false;

        // Persist before dispatch: a crashed invocation is not duplicated automatically.
        if (!await stores(targetId).claimJob(key)) return false;
        const started = Date.now();
        const response = await environment.DISPATCH.get(deployment.workerName!, { props: { APP_DATA: data(targetId), job: { id: job.id, scheduledAt } } }, { limits: { cpuMs: 50, subRequests: 20 } }).fetch(new Request(`https://entity.invalid${job.path}`, { method: 'POST' }));
        await response.body?.cancel();
        await environment.BUILDS.put(`private-jobs/${targetId}/${key}.json`, JSON.stringify({ deploymentId: deployment.id, jobId: job.id, scheduledAt, status: response.status, finishedAt: new Date().toISOString() }));
        await world.recordTraffic(targetId, 'internal', response.status, Date.now() - started, `${deployment.id}:${key}`);

        return true;
      }, dispatched => dispatched ? null : 0);
    }
  }
}
