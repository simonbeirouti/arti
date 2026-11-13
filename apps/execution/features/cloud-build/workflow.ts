import { codeScope } from './code-scope';
import { requirePublication, type PublicationConfiguration } from '../publication/gate';
/// <reference types="@cloudflare/workers-types" />
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { buildFailureMarkerKey, deterministicBuildFailure, privateBuildCapture } from './build-diagnostics';
import { buildRequestSchema, type BuildRequest } from './build-request';
import { serviceManifestSchema } from '../application-services/manifest';
import { LiveGate, TrustedUploader, type AllowanceAuthority } from '../../../../packages/provider-adapters/src/cloudflare';
import { matchingPublication, needsBuildEvidenceRecovery, publishOrReplay } from './publication-replay';
import { validateAuthoringScope } from './authoring-scope';
import type { Deployment, PublicAuthoringScope } from '../../../../packages/contracts/src/index';
import type { BuildSandbox } from './sandbox';
import type { WorldDurableObject } from '../../../world/src/index';

export { buildRequestSchema, type BuildRequest } from './build-request';

export interface PublicationAuthority extends AllowanceAuthority {
  acquirePublication(entityId: string, workflowId: string, projectId?: string): Promise<boolean>;
  authorizePublication(entityId: string, expectedCommit: string | null, goalId?: string, revision?: number, workflowId?: string, projectId?: string): Promise<void>;
  completeDeployment(deployment: Deployment, workflowId: string, expectedCommit: string | null, authoringScope?: PublicAuthoringScope): Promise<void>;
  releasePublication(entityId: string, workflowId: string, projectId?: string): Promise<void>;
}

export type BuildEnvironment = PublicationConfiguration & {
  LIVE_ACTIVATED: string;
  DAILY_ALLOWANCE_USD: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  DEPLOY_TOKEN: string;
  STAGING_NAMESPACE: string;
  PRODUCTION_NAMESPACE: string;
  ARTIFACTS: Artifacts;
  BUILD_SANDBOX: DurableObjectNamespace<BuildSandbox>;
  BUILDS: R2Bucket;
  STAGING: DispatchNamespace;
  WORLD: DurableObjectNamespace<WorldDurableObject>;
};

/** Authenticated source events must be normalized by platform code into BuildRequest. */
export class PublicationWorkflow extends WorkflowEntrypoint<BuildEnvironment, BuildRequest> {
  async run(event: WorkflowEvent<BuildRequest>, step: WorkflowStep): Promise<Deployment> {
    requirePublication(this.env);
    const request = buildRequestSchema.parse(event.payload);
    const world = this.env.WORLD.getByName('arti-world');
    // RPC interface is supplied only by the configured authoritative world service.
    const authority: PublicationAuthority = world;

    const checkAuthoring = async (): Promise<void> => {
      const state = await world.inspect();
      const scope = validateAuthoringScope(state, request.entityId, request.authoringScope, request.taskId);

      if (scope) await world.authorizePublicTurn(request.entityId, scope);
    };

    const initialState = await world.inspect();
    const savedReceipt = matchingPublication(initialState, request, `deployment-${event.instanceId}`);
    const targetScope = savedReceipt ? { repoName: request.repoName, projectId: request.projectId, canonicalRepoName: request.projectId ? initialState.projects?.find(project => project.id === request.projectId)?.repository : request.entityId } : codeScope(initialState, request.entityId, request.taskId);

    if (request.projectId !== targetScope.projectId || (request.repoName !== targetScope.repoName && (request.projectId || request.repoName !== request.entityId))) throw new Error('Build target differs from trusted task scope');
    const canonicalRepoName = targetScope.canonicalRepoName ?? request.entityId;
    const targetId = request.projectId ?? request.entityId;


    if (!savedReceipt) await checkAuthoring();
    const gate = new LiveGate({ activated: this.env.LIVE_ACTIVATED === 'true', dailyAllowanceUsd: Number(this.env.DAILY_ALLOWANCE_USD) }, authority);

    const lease = await step.do('acquire entity publication lease', () => gate.run(request.entityId, 0.001, 'publication.lease', async () => {
      if (request.repoName !== canonicalRepoName && request.repoName !== targetScope.repoName) throw new Error('Repository is not owned by entity');

      if (!(await authority.acquirePublication(request.entityId, event.instanceId, request.projectId))) throw new Error('Entity publication is occupied');
      const state = await world.inspect();
      const history = state.deployments.filter((deployment) => request.projectId ? deployment.projectId === request.projectId : deployment.entityId === request.entityId && !deployment.projectId);

      return { expectedCommit: history.at(-1)?.commit ?? null, nextVersion: (history.at(-1)?.version ?? 0) + 1 };
    }));

    try {
      const canonicalHead = await step.do('pin canonical Git head', async () => {
        await checkAuthoring();

        return gate.run(request.entityId, 0.005, 'artifacts.head', async () => {
        using repository = await this.env.ARTIFACTS.get(canonicalRepoName);
        const info = await repository.info();
        const token = await repository.createToken('read', 120);

        try { return await this.env.BUILD_SANDBOX.getByName(`head-${event.instanceId}-${crypto.randomUUID()}`).canonicalHead(info.remote, token.plaintext); }
        finally { await repository.revokeToken(token.id); }
        });
      });

      if (request.repoName === canonicalRepoName && canonicalHead !== request.commit) throw new Error('Canonical push has been superseded');

      const output = await step.do('build pinned public code offline', { retries: { limit: 2, delay: '10 seconds' }, timeout: '5 minutes' }, async () => {
        await checkAuthoring();

        return gate.run(request.entityId, 0.05, 'execution.build', async () => {
        using repo = await this.env.ARTIFACTS.get(request.repoName);
        const worker = await repo.readFile({ ref: request.commit, path: 'site/worker.ts' });
        const tests = await repo.readFile({ ref: request.commit, path: 'tests/worker.test.mjs' });

        if (!worker || !tests) throw new Error('Public Worker source and tests are required');

        if (worker.size > 200_000 || tests.size > 100_000) throw new Error('Source exceeds bounded build size');
        const sandbox = this.env.BUILD_SANDBOX.getByName(`${event.instanceId}-${crypto.randomUUID()}`);
        const checked = await sandbox.buildChecked({ worker: await worker.text(), tests: await tests.text() });

        if (!checked.ok) {
          const key = `private-build-failures/${event.instanceId}/${crypto.randomUUID()}.json`;
          await this.env.BUILDS.put(key, JSON.stringify(privateBuildCapture(checked.failure, { sourceRevision: request.commit, repository: request.repoName, entityId: request.entityId, workflowId: event.instanceId })), { onlyIf: { etagDoesNotMatch: '*' } });
          await this.env.BUILDS.put(buildFailureMarkerKey(request.repoName, request.commit), JSON.stringify({ code: checked.failure.category, commit: request.commit }), { onlyIf: { etagDoesNotMatch: '*' } });
          const message = `Isolated build failed: ${checked.failure.category}; private diagnostics captured`;

          if (deterministicBuildFailure(checked.failure)) throw new NonRetryableError(message);
          throw new Error(message);
        }

        const result = checked.output;

        const manifest = await repo.readFile({ ref: request.commit, path: 'site/services.json' });

        if (manifest && manifest.size > 10_000) throw new Error('Service manifest too large');
        const services = serviceManifestSchema.parse(manifest ? JSON.parse(await manifest.text()) : { jobs: [] });

        return { compiled: result.compiled, assertions: [...result.assertions], services };
        });
      });

      await world.validatePublicText(output.compiled);

      const hash = await step.do('save immutable bundle and evidence', async () => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(output.compiled));
        const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
        await this.env.BUILDS.put(`bundles/${hash}.js`, output.compiled, { onlyIf: { etagDoesNotMatch: '*' } });
        await this.env.BUILDS.put(`manifests/deployment-${event.instanceId}.json`, JSON.stringify(output.services), { onlyIf: { etagDoesNotMatch: '*' } });
        await this.env.BUILDS.put(`private-evidence/${event.instanceId}.json`, JSON.stringify({ request, assertions: output.assertions, environment: 'staging', bundleHash: hash }));

        return hash;
      });

      const workerName = `${targetId.slice(0, 15)}-${hash}`;
      const uploader = new TrustedUploader(this.env.CLOUDFLARE_ACCOUNT_ID, this.env.DEPLOY_TOKEN, gate);
      const bundle: import('../../../../packages/provider-adapters/src/cloudflare').WorkerBundle = { mainModule: 'index.js', modules: [{ name: 'index.js', content: output.compiled, type: 'application/javascript+module' }] };
      await step.do('upload staging modules', async () => {
        await checkAuthoring();
        await uploader.upload(request.entityId, this.env.STAGING_NAMESPACE, bundle, workerName);
      });
      await step.do('staging HTTP smoke check', async () => {
        const response = await this.env.STAGING.get(workerName).fetch(new Request('https://entity.invalid/'));

        if (response.status >= 500) throw new Error('Staging smoke failed');
      });
      await step.do('promote checked canonical Git revision', async () => {
        requirePublication(this.env);
        await checkAuthoring();
        await authority.authorizePublication(request.entityId, lease.expectedCommit, request.goalId, request.revision, event.instanceId, request.projectId);

        if (request.repoName === canonicalRepoName) return;
        await gate.run(request.entityId, 0.005, 'artifacts.promote', async () => {
          using canonical = await this.env.ARTIFACTS.get(canonicalRepoName);
          using fork = await this.env.ARTIFACTS.get(request.repoName);
          const canonicalInfo = await canonical.info();
          const forkInfo = await fork.info();
          const readToken = await fork.createToken('read', 120);
          const writeToken = await canonical.createToken('write', 120);

          try { await this.env.BUILD_SANDBOX.getByName(`promote-${event.instanceId}-${crypto.randomUUID()}`).promote(forkInfo.remote, canonicalInfo.remote, readToken.plaintext, writeToken.plaintext, canonicalHead, request.commit); }
          finally { await fork.revokeToken(readToken.id); await canonical.revokeToken(writeToken.id); }
        });
      });

      return await step.do('fenced production publication', async () => {
        const state = await world.inspect();

        return publishOrReplay(state, request, `deployment-${event.instanceId}`, hash, async () => {
        requirePublication(this.env);
        await checkAuthoring();
        await authority.authorizePublication(request.entityId, lease.expectedCommit, request.goalId, request.revision, event.instanceId, request.projectId);
        await uploader.upload(request.entityId, this.env.PRODUCTION_NAMESPACE, bundle, workerName);
        const deployment: Deployment = { id: `deployment-${event.instanceId}`, entityId: request.entityId, commit: request.commit, version: lease.nextVersion, environment: 'production', status: 'published', createdAt: new Date().toISOString(), bundleHash: hash, workerName, taskId: request.taskId };

        if (request.projectId) deployment.projectId = request.projectId;

        if (request.goalId) deployment.goalId = request.goalId;

        if (request.revision) deployment.revision = request.revision;
        await checkAuthoring();
        await authority.completeDeployment(deployment, event.instanceId, lease.expectedCommit, request.authoringScope);

        if (request.goalId) await world.completeTaskFromBuild(request.taskId, deployment.id, [], output.assertions, `build-evidence-${event.instanceId}`);

        return deployment;
        }, async deployment => {
          const evidenceId = `build-evidence-${event.instanceId}`;

          if (needsBuildEvidenceRecovery(state, request, evidenceId)) await world.completeTaskFromBuild(request.taskId, deployment.id, [], output.assertions, evidenceId).catch(() => { console.warn('Saved publication evidence recovery deferred'); });
        });
      });
    } catch (error) {
      await world.noteOperation('execution.publication_failure').catch(() => { console.warn('Publication failure metric unavailable'); });
      throw error;
    } finally { await authority.releasePublication(request.entityId, event.instanceId, request.projectId); }
  }
}
