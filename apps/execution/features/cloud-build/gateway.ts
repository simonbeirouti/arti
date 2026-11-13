import { assertEvaluationRelease } from '../../../world/features/model-evaluations/ledger';
import { publishVisitorBaseline } from '../visitor-baseline/pipeline';
import { helloWorldWorker, helloWorldTests, helloWorldServices } from '../visitor-baseline/content';
import { reviewDeployment, reviewContent, type ReviewObservation } from '../../../world/features/visitor-governance/observation';
import { backupStorageTarget } from '../backup-export/scope';
import { bundleMainCommit, retainedGitExport } from '../backup-export/integrity';
import { requirePublication } from '../publication/gate';
/// <reference types="@cloudflare/workers-types" />
import { WorkerEntrypoint } from 'cloudflare:workers';
import { z } from 'zod';
import { verifyEvaluationWorker } from '../../../../packages/provider-adapters/src/evaluation';
import type { ApplicationStore } from '../application-services/data';
import { BrowserResearch } from '../browser-research/capture';
import { buildInputSchema, type BuildOutput } from './sandbox';
import { LiveGate, ResearchAdapter, TrustedUploader } from '../../../../packages/provider-adapters/src/cloudflare';
import { publicAuthoringScopeSchema, type PublicAuthoringScope } from '../../../../packages/contracts/src/index';
import { executionAuthoringScope, validateAuthoringScope } from './authoring-scope';
import { codeScope } from './code-scope';
import { buildFailureMarkerKey, parseBuildFailureMarker } from './build-diagnostics';
import { type BuildEnvironment, type BuildRequest } from './workflow';

interface ForkReceipt { repoName: string; remote: string; commit: string | null; lastBuildFailure?: { code: string; commit: string } }

type Environment = BuildEnvironment & { MODEL_EVALUATED?: string; DISPATCH: DispatchNamespace; ENTITY_DOMAIN: string; PUBLICATION: Workflow<BuildRequest>; RESEARCH_ALLOWED_HOSTS?: string; BROWSER: BrowserRun; EVALUATIONS_ENABLED?: string; BACKUPS_ENABLED?: string; APP_DATA: DurableObjectNamespace<ApplicationStore> };

const researchInput = z.object({ url: z.string().url().max(4000), taskId: z.string().min(1).max(100).optional() }).strict();

const taskInput = z.object({ taskId: z.string().min(1).max(100) });

const patchInput = taskInput.extend({ path: z.string().min(1).max(200), content: z.string().max(200_000), message: z.string().min(1).max(500) }).strict();

const readInput = taskInput.extend({ commit: z.string().regex(/^[a-f0-9]{40}$/), path: z.string().min(1).max(200) }).strict();

const buildInput = taskInput.extend({ commit: z.string().regex(/^[a-f0-9]{40}$/) }).strict();

/** Internal service entrypoint only: authenticated EntityAgent supplies its own stable identity. */
export class ExecutionGateway extends WorkerEntrypoint<Environment> {
  /** Owner Workflow only: no HTTP route, agent tool, caller source or caller actor is accepted. */
  async bootstrapVisitorBaseline(resetId: string) {
    requirePublication(this.env);

    if (this.env.LIVE_ACTIVATED !== 'true' || this.env.MODEL_EVALUATED !== 'true' || !Number.isFinite(Number(this.env.DAILY_ALLOWANCE_USD)) || Number(this.env.DAILY_ALLOWANCE_USD) <= 0) throw new Error('Platform baseline requires explicit evaluated live allowance');
    const world = this.env.WORLD.getByName('arti-world');
    assertEvaluationRelease(await world.evaluationFingerprint());
    const key = `platform-baselines/${z.uuid().parse(resetId)}.json`;

    return publishVisitorBaseline(resetId, {
      authority: {
        authorize: (id, attemptId) => world.authorizeVisitorBaseline(id, attemptId),
        reserve: (id, attemptId, amount, operation) => world.reserveVisitorBaseline(id, attemptId, amount, operation),
        settle: (id, actual) => world.settle(id, actual),
        complete: (id, attemptId, deployment, baselineHash, assertions) => world.completeVisitorBaseline(id, attemptId, deployment, baselineHash, assertions),
        release: (id, attemptId) => world.releaseVisitorBaseline(id, attemptId),
      },
      checkpoint: async () => {
        const object = await this.env.BUILDS.get(key);

        if (object && object.size > 10000) throw new Error('Baseline checkpoint exceeds limit');

        return object ? object.text() : null;
      },
      saveCheckpoint: async (_id, checkpoint) => { await this.env.BUILDS.put(key, JSON.stringify(checkpoint)); },
      canonicalHead: async repositoryName => {
        using repository = await this.env.ARTIFACTS.get(repositoryName);
        const info = await repository.info();
        const token = await repository.createToken('read', 120);

        try { return await this.env.BUILD_SANDBOX.getByName(`baseline-head-${crypto.randomUUID()}`).canonicalHead(info.remote, token.plaintext); }
        finally { await repository.revokeToken(token.id); }
      },
      matchesSource: async (repositoryName, commit) => {
        using repository = await this.env.ARTIFACTS.get(repositoryName);
        const worker = await repository.readFile({ ref: commit, path: 'site/worker.ts' });
        const tests = await repository.readFile({ ref: commit, path: 'tests/worker.test.mjs' });
        const services = await repository.readFile({ ref: commit, path: 'site/services.json' });

        if (!worker || !tests || !services || worker.size > 10000 || tests.size > 10000 || services.size > 100) return false;

        return await worker.text() === helloWorldWorker && await tests.text() === helloWorldTests && await services.text() === helloWorldServices;
      },
      appendSource: async (repositoryName, expectedHead, id) => {
        using repository = await this.env.ARTIFACTS.get(repositoryName);
        const info = await repository.info();
        const token = await repository.createToken('write', 120);

        try { return await this.env.BUILD_SANDBOX.getByName(`baseline-git-${crypto.randomUUID()}`).bootstrapBaseline(info.remote, token.plaintext, expectedHead, id); }
        finally { await repository.revokeToken(token.id); }
      },
      build: async () => this.env.BUILD_SANDBOX.getByName(`baseline-build-${crypto.randomUUID()}`).build({ worker: helloWorldWorker, tests: helloWorldTests }),
      saveBundle: async (hash, output, id) => {
        await this.env.BUILDS.put(`bundles/${hash}.js`, output.compiled, { onlyIf: { etagDoesNotMatch: '*' } });
        await this.env.BUILDS.put(`manifests/deployment-platform-baseline-${id}.json`, helloWorldServices, { onlyIf: { etagDoesNotMatch: '*' } });
      },
      readBundle: async hash => {
        const object = await this.env.BUILDS.get(`bundles/${hash}.js`);

        if (!object || object.size > 1000000) throw new Error('Retained baseline bundle unavailable');

        return object.text();
      },
      upload: async (environment, bundle, name, gate) => {
        const uploader = new TrustedUploader(this.env.CLOUDFLARE_ACCOUNT_ID, this.env.DEPLOY_TOKEN, gate);
        await uploader.upload('platform-bootstrap', environment === 'staging' ? this.env.STAGING_NAMESPACE : this.env.PRODUCTION_NAMESPACE, bundle, name);
      },
      smoke: async (environment, name) => (environment === 'staging' ? this.env.STAGING : this.env.DISPATCH).get(name, undefined, { limits: { cpuMs: 50, subRequests: 0 } }).fetch(new Request(`https://collective.${this.env.ENTITY_DOMAIN}/`, { redirect: 'manual', signal: AbortSignal.timeout(15000) })),
    });
  }
  async observePublished(reviewerId: string, goalId: string, revision: number): Promise<ReviewObservation> {
    requirePublication(this.env);

    if (this.env.LIVE_ACTIVATED !== 'true') throw new Error('Live review disabled');
    const world = this.env.WORLD.getByName('arti-world');
    const { goal, deployment } = reviewDeployment(await world.inspect(), reviewerId, goalId, revision);
    const reservationId = `review-observation-${crypto.randomUUID()}`;
    const reservation = await world.reserve(reviewerId, 0.01, reservationId);

    try {
      const request = new Request(`https://${goal.projectId}.${this.env.ENTITY_DOMAIN}/`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      const response = await this.env.DISPATCH.get(deployment.workerName!, undefined, { limits: { cpuMs: 50, subRequests: 0 } }).fetch(request);
      const content = await reviewContent(response);
      const observation: ReviewObservation = { id: crypto.randomUUID(), reviewerId, goalId, revision, deploymentId: deployment.id, commit: deployment.commit, bundleHash: deployment.bundleHash, createdAt: new Date().toISOString(), status: response.status, content };
      await world.recordReviewObservation(observation);
      // Dispatch billing is not attributable from this response; retain the bounded charge.
      await world.settle(reservation.id, null);

      return observation;
    } catch (error) { await world.settle(reservation.id, null); throw error; }
  }
  async exportApplicationData(entityId: string, backupId: string): Promise<{ key: string; sha256: string }> {
    if (this.env.BACKUPS_ENABLED !== 'true') throw new Error('Application backup export disabled');
    await this.env.WORLD.getByName('arti-world').authorizeBackupExport(entityId, backupId, false);
    backupStorageTarget(await this.env.WORLD.getByName('arti-world').inspect(), entityId);

    return this.env.APP_DATA.getByName(entityId).exportSnapshot(entityId, backupId);
  }
  async restoreApplicationData(entityId: string, backupId: string, snapshot: { key: string; sha256: string }): Promise<void> {
    if (this.env.BACKUPS_ENABLED !== 'true' || snapshot.key !== `app-backups/${backupId}/${entityId}.json`) throw new Error('Invalid application restore scope');
    z.string().regex(/^[a-f0-9]{64}$/).parse(snapshot.sha256);
    await this.env.WORLD.getByName('arti-world').authorizeBackupRestore(entityId, backupId, snapshot.key, snapshot.sha256);
    backupStorageTarget(await this.env.WORLD.getByName('arti-world').inspect(), entityId);
    await this.env.APP_DATA.getByName(entityId).restoreSnapshot(snapshot.key, snapshot.sha256);
  }
  async releaseApplicationDataFreeze(entityId: string): Promise<void> {
    backupStorageTarget(await this.env.WORLD.getByName('arti-world').inspect(), entityId);
    await this.env.APP_DATA.getByName(entityId).releaseFreeze();
  }
  async restoreCanonical(entityId: string, backupId: string, repository: { entityId: string; key: string; commit: string; sha256: string }): Promise<void> {
    if (this.env.BACKUPS_ENABLED !== 'true' || repository.entityId !== entityId || repository.key !== `git-backups/${backupId}/${entityId}.bundle`) throw new Error('Invalid Git restore scope');
    const parsed = z.object({ entityId: z.string(), key: z.string(), commit: z.string().regex(/^[a-f0-9]{40}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(repository);
    await this.env.WORLD.getByName('arti-world').authorizeBackupRestore(entityId, backupId, parsed.key, parsed.sha256);
    const stored = await this.env.BUILDS.get(parsed.key);

    if (!stored || stored.size > 600_000) throw new Error('Retained Git export unavailable');
    const bytes = new Uint8Array(await stored.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');

    if (sha256 !== parsed.sha256) throw new Error('Git backup integrity failure');
    let binary = '';

    for (const byte of bytes) binary += String.fromCharCode(byte);
    const target = backupStorageTarget(await this.env.WORLD.getByName('arti-world').inspect(), entityId);
    using canonical = await this.env.ARTIFACTS.get(target.repositoryName);
    const info = await canonical.info();
    const token = await canonical.createToken('write', 120);

    try { await this.env.BUILD_SANDBOX.getByName(`restore-${crypto.randomUUID()}`).restoreGit(info.remote, token.plaintext, btoa(binary), parsed.commit); }
    finally { await canonical.revokeToken(token.id); }
  }
  async exportCanonical(entityId: string, backupId: string): Promise<{ key: string; commit: string; sha256: string }> {
    if (this.env.BACKUPS_ENABLED !== 'true') throw new Error('Git backup export disabled');
    z.string().regex(/^[a-z0-9_-]{1,100}$/).parse(backupId);
    z.string().regex(/^[a-z0-9_-]{1,80}$/).parse(entityId);
    await this.env.WORLD.getByName('arti-world').authorizeBackupExport(entityId, backupId, false);
    const target = backupStorageTarget(await this.env.WORLD.getByName('arti-world').inspect(), entityId);
    const key = `git-backups/${backupId}/${entityId}.bundle`;
    const retained = await retainedGitExport(this.env.BUILDS, key);

    if (retained) return retained;
    await this.env.WORLD.getByName('arti-world').authorizeBackupExport(entityId, backupId, true);
    using repository = await this.env.ARTIFACTS.get(target.repositoryName);
    const info = await repository.info();
    const token = await repository.createToken('read', 120);

    try {
      const result = await this.env.BUILD_SANDBOX.getByName(`export-${crypto.randomUUID()}`).exportGit(info.remote, token.plaintext);
      const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0));

      if (bytes.byteLength > 600_000 || bundleMainCommit(bytes) !== result.commit) throw new Error('Git export revision mismatch');

      await this.env.BUILDS.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' } });
      const receipt = await retainedGitExport(this.env.BUILDS, key);

      if (!receipt) throw new Error('Git export persistence missing');

      return receipt;
    } finally { await repository.revokeToken(token.id); }
  }
  async rollback(entityId: string, deploymentId: string): Promise<import('../../../../packages/contracts/src/index').Deployment> {
    requirePublication(this.env);
    const world = this.env.WORLD.getByName('arti-world');
    const state = await world.inspect();
    const target = state.deployments.find(item => item.id === deploymentId && item.entityId === entityId && item.environment === 'production');
    const targetId = target?.projectId ?? entityId;
    const latest = state.deployments.findLast(item => target?.projectId ? item.projectId === target.projectId : item.entityId === entityId && !item.projectId);

    if (!target || !latest || target.id === latest.id || target.workerName !== `${targetId.slice(0, 15)}-${target.bundleHash}`) throw new Error('Invalid rollback target');
    const workflowId = `rollback-${crypto.randomUUID()}`;
    const gate = new LiveGate({ activated: this.env.LIVE_ACTIVATED === 'true', dailyAllowanceUsd: Number(this.env.DAILY_ALLOWANCE_USD) }, world);

    return gate.run(entityId, 0.005, 'deployment.rollback', async () => {
      if (!await world.acquirePublication(entityId, workflowId, target.projectId)) throw new Error('Entity publication occupied');

      try {
        await world.authorizeRollback(entityId, workflowId, latest.commit, target.projectId);
        const stored = await this.env.BUILDS.get(`bundles/${target.bundleHash}.js`);

        if (!stored || stored.size > 1_000_000) throw new Error('Retained rollback bundle unavailable');
        const compiled = await stored.text();
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(compiled))), byte => byte.toString(16).padStart(2, '0')).join('');

        if (digest !== target.bundleHash) throw new Error('Rollback bundle integrity failure');
        await world.validatePublicText(compiled);
        const uploader = new TrustedUploader(this.env.CLOUDFLARE_ACCOUNT_ID, this.env.DEPLOY_TOKEN, gate);
        await uploader.upload(entityId, this.env.PRODUCTION_NAMESPACE, { mainModule: 'index.js', modules: [{ name: 'index.js', content: compiled, type: 'application/javascript+module' }] }, target.workerName);
        const deployment = { ...target, id: workflowId, version: latest.version + 1, createdAt: new Date().toISOString(), status: 'rolled_back' as const };
        delete deployment.goalId;
        delete deployment.revision;
        delete deployment.taskId;
        const manifest = await this.env.BUILDS.get(`manifests/${target.id}.json`);

        if (manifest) await this.env.BUILDS.put(`manifests/${deployment.id}.json`, await manifest.text());
        await world.completeRollback(deployment, workflowId, latest.commit);

        return deployment;
      } finally { await world.releasePublication(entityId, workflowId, target.projectId); }
    });
  }
  async evaluateCode(evaluationId: string, worker: string, tests: string): Promise<BuildOutput> {
    if (this.env.EVALUATIONS_ENABLED !== 'true') throw new Error('Evaluation execution disabled');
    const input = buildInputSchema.parse({ worker, tests });
    await this.env.WORLD.getByName('arti-world').authorizeEvaluation(evaluationId, 'coding-build');
    const result = await this.env.BUILD_SANDBOX.getByName(`evaluation-${evaluationId}-${crypto.randomUUID()}`).build(input);
    const name = `evaluation-${z.string().uuid().parse(evaluationId)}`;

    // A one-shot world evaluation authorization above covers this fixed staging-only operation.
    // It grants neither agent activation nor access to production or canonical repositories.
    const evaluationGate = {
      async run<T>(entity: string, _estimate: number, operation: string, action: () => Promise<T>): Promise<T> {
        if (entity !== 'evaluation' || operation !== 'deployment.upload') throw new Error('Invalid evaluation provider operation');

        return action();
      },
    };

    const uploader = new TrustedUploader(this.env.CLOUDFLARE_ACCOUNT_ID, this.env.DEPLOY_TOKEN, evaluationGate);

    try {
      await uploader.upload('evaluation', this.env.STAGING_NAMESPACE, { mainModule: 'index.js', modules: [{ name: 'index.js', content: result.compiled, type: 'application/javascript+module' }] }, name);
      const assertions = await verifyEvaluationWorker(this.env.STAGING.get(name));

      return { compiled: result.compiled, assertions: [...result.assertions, ...assertions] };
    } finally {
      await this.#cleanupEvaluation(name);
    }
  }
  async #cleanupEvaluation(name: string): Promise<void> {
      if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(this.env.CLOUDFLARE_ACCOUNT_ID) || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(this.env.STAGING_NAMESPACE)) throw new Error('Invalid evaluation provider configuration');
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.env.CLOUDFLARE_ACCOUNT_ID}/workers/dispatch/namespaces/${this.env.STAGING_NAMESPACE}/scripts/${name}`, { method: 'DELETE', signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${this.env.DEPLOY_TOKEN}` } });

      if (!response.ok && response.status !== 404) throw new Error('Evaluation staging cleanup failed');
  }
  async execute(entityId: string, tool: string, argumentsJson: string, authoringScope?: PublicAuthoringScope): Promise<string> {
    if (tool === 'execution.request_build') requirePublication(this.env);
    const world = this.env.WORLD.getByName('arti-world');
    const state = await world.inspect();

    if (state.mode !== 'live' || state.paused || !state.entities.some(entity => entity.id === entityId)) throw new Error('Entity execution disabled');

    if (authoringScope) publicAuthoringScopeSchema.parse(authoringScope);
    const checked = executionAuthoringScope(state, entityId, tool, authoringScope);

    if (checked) await world.authorizePublicTurn(entityId, checked);
    const input = JSON.parse(argumentsJson);
    const gate = new LiveGate({ activated: this.env.LIVE_ACTIVATED === 'true', dailyAllowanceUsd: Number(this.env.DAILY_ALLOWANCE_USD) }, world);

    if (['data.get', 'data.put', 'data.delete'].includes(tool)) {
      const args = z.object({ key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/), value: z.string().max(32_000).optional() }).strict().parse(input);
      const store = this.env.APP_DATA.getByName(entityId);

      return gate.run(entityId, 0.001, tool, async () => {
        if (tool === 'data.get') return JSON.stringify({ value: await store.get(args.key) });

        if (tool === 'data.delete') { await store.delete(args.key);

          return JSON.stringify({ deleted: true }); }

        if (args.value === undefined) throw new Error('Data value required');
        await world.validatePublicText(args.value);
        await store.put(args.key, args.value);

        return JSON.stringify({ saved: true });
      });
    }

    if (tool === 'research.retrieve' || tool === 'research.browser') {
      const args = researchInput.parse(input);
      const researchTaskId = args.taskId ?? authoringScope?.taskId;

      if (authoringScope && researchTaskId !== authoringScope.taskId) throw new Error('Research task differs from trusted authoring task');
      const active = state.goals.find(goal => goal.status === 'active');

      if (active || researchTaskId) {
        const assignment = state.tasks.find(task => task.id === researchTaskId && task.entityId === entityId && task.goalId === active?.id && task.revision === active?.revision && ['queued', 'running'].includes(task.status));

        if (!assignment) throw new Error('Research must belong to the current assigned task');
      }

      const allowed = (this.env.RESEARCH_ALLOWED_HOSTS ?? '').split(',').map(host => host.trim()).filter(Boolean);
      await world.validatePublicText(args.url);

      if (tool === 'research.browser') return JSON.stringify(await new BrowserResearch(this.env.BROWSER, this.env.BUILDS, gate, allowed).capture(entityId, args.url));
      const research = new ResearchAdapter(allowed, gate);

      return JSON.stringify(await research.retrieve(entityId, args.url));
    }

    const context = taskInput.parse(input);

    if (authoringScope) validateAuthoringScope(state, entityId, authoringScope, context.taskId);
    const scope = codeScope(state, entityId, context.taskId);
    const repoName = scope.repoName;

    return gate.run(entityId, 0.01, tool, async () => {
      if (tool === 'repo.fork') {
        taskInput.strict().parse(input);

        try {
          using existing = await this.env.ARTIFACTS.get(repoName);
          const info = await existing.info();
          const history = await existing.log({ ref: 'main', limit: 1 });

          const commit = history[0]?.hash ?? null;
          const marker = commit ? await this.env.BUILDS.get(buildFailureMarkerKey(repoName, commit)) : null;
          const lastBuildFailure = marker && commit ? parseBuildFailureMarker(await marker.text(), commit) : undefined;

          const receipt: ForkReceipt = { repoName, remote: info.remote, commit };

          if (lastBuildFailure) receipt.lastBuildFailure = lastBuildFailure;

          return JSON.stringify(receipt);
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'NOT_FOUND')) throw error;
        }

        using canonical = await this.env.ARTIFACTS.get(scope.canonicalRepoName ?? entityId);
        const fork = await canonical.fork(repoName, { defaultBranchOnly: true, readOnly: false });
        using repository = await this.env.ARTIFACTS.get(fork.name);
        await repository.revokeToken(fork.token);
        const history = await repository.log({ ref: 'main', limit: 1 });

        return JSON.stringify({ repoName: fork.name, remote: fork.remote, commit: history[0]?.hash ?? null });
      }

      if (tool === 'repo.read') {
        const args = readInput.parse(input);

        if (!/^(site|tests|content)\/[a-zA-Z0-9_./-]+$/.test(args.path) || args.path.includes('..')) throw new Error('Only public source paths may be read');
        using repository = await this.env.ARTIFACTS.get(repoName);
        const blob = await repository.readFile({ ref: args.commit, path: args.path });

        if (!blob || blob.size > 200_000) throw new Error('Source missing or too large');

        return blob.text();
      }

      if (tool === 'repo.patch_commit') {
        const args = patchInput.parse(input);
        using repository = await this.env.ARTIFACTS.get(repoName);
        const info = await repository.info();
        const token = await repository.createToken('write', 120);

        try {
          const transport = this.env.BUILD_SANDBOX.getByName(`edit-${crypto.randomUUID()}`);
          const commit = await transport.edit(info.remote, token.plaintext, args.path, args.content, args.message);

          return JSON.stringify({ repoName, commit });
        } finally { await repository.revokeToken(token.id); }
      }

      if (tool === 'execution.request_build') {
        const args = buildInput.parse(input);
        const id = `${scope.projectId ? `${scope.projectId}-` : ''}${entityId}-${args.commit}`;
        const request: BuildRequest = { entityId, repoName, commit: args.commit, taskId: scope.taskId };

        if (scope.projectId) request.projectId = scope.projectId;

        if (authoringScope) request.authoringScope = authoringScope;

        if (scope.goalId) { request.goalId = scope.goalId; request.revision = scope.revision; }

        try { await this.env.PUBLICATION.create({ id, params: request }); } catch (error) {
          try { await this.env.PUBLICATION.get(id); } catch { throw error; }
        }

        return JSON.stringify({ workflowId: id, status: 'queued' });
      }

      throw new Error('Unsupported execution tool');
    });
  }
}
