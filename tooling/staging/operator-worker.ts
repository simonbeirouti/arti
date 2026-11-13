import { entityDailyCommitment, reservationCommitment } from '../../packages/domain/src/daily-budget';
import { archiveAndClearSharedWork } from '../features/shared-reset/work';
import { resetReceiptSchema, baselineDeploymentSchema } from '../../apps/world/features/visitor-reset/ledger';
import { visitorAgentCaps, visitorWorldCap, visitorStepCandidates, visitorStatus } from './visitor-policy';
import { releaseFingerprint } from '../../apps/world/generated/release';
/// <reference types="@cloudflare/workers-types" />
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { getAgentByName } from 'agents';
import { z } from 'zod';
import type { EntityAgent } from '../../apps/agent-runtime/src/worker';
import { assertEvaluationRelease, type ModelEvaluation } from '../../apps/world/features/model-evaluations/ledger';
import { handleEvaluations, type EvaluationEnvironment } from '../../apps/world/features/model-evaluations/http';
import type { WorldDurableObject } from '../../apps/world/src/index';
import { turnOutcomeMetric } from '../../apps/world/features/operations/turn-outcome';
import { stagingOperatorRequest, stagingAgentCaps, stagingWorldCap, turnDiagnostics, probeError } from './operator-policy';
import type { Deployment } from '../../packages/contracts/src/index';

type Environment = EvaluationEnvironment & { WORLD_BACKUPS?: R2Bucket; WORLD: DurableObjectNamespace<WorldDurableObject>; ENTITY_AGENT?: DurableObjectNamespace<EntityAgent>; SETUP_ENABLED?: string; EXECUTION?: EvaluationEnvironment['EXECUTION'] & { bootstrapVisitorBaseline(resetId: string): Promise<Deployment>; exportCanonical(entityId: string, backupId: string): Promise<{key: string; commit: string; sha256: string}>; exportApplicationData(entityId: string, backupId: string): Promise<{key: string; sha256: string}>; execute(entityId: string, tool: string, input: string): Promise<string> } };

/** Invoked only through the authenticated account Workflows API, never an HTTP route or agent tool. */
export class StagingOperatorWorkflow extends WorkflowEntrypoint<Environment, unknown> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep) {
    if (this.env.SETUP_ENABLED !== 'true') throw new Error('Staging setup is disabled');
    const request = stagingOperatorRequest.parse(event.payload);
    const world = this.env.WORLD.getByName('arti-world');
    let backupOutcome: string | undefined;

    if (request.operation === 'visitor-reset') {
      const agents = this.env.ENTITY_AGENT;
      const storage = this.env.WORLD_BACKUPS;
      const execution = this.env.EXECUTION;

      if (!execution || !agents || !storage) throw new Error('Shared website reset bindings required');
      const options = { retries: { limit: 0, delay: '1 second' as const }, timeout: '10 minutes' as const };

      const reset = await step.do('reset-shared-public-workspace', options, async () => {
        assertEvaluationRelease(await world.evaluationFingerprint());

        return resetReceiptSchema.parse(await world.resetSharedWebsite(event.instanceId, request.acknowledgement));
      });

      const entityIds = await step.do('read-reset-entity-identities', async () => (await world.inspect()).entities.map(entity => entity.id));

      if (reset.status !== 'published') for (const entityId of entityIds) await step.do(`archive-reset-work-${entityId}`, options, async () => {
        const agent = await getAgentByName(agents, entityId);

        const archive = await archiveAndClearSharedWork(event.instanceId, entityId, {
          authorize: (id, entity) => world.authorizeResetEntity(id, entity),
          read: async key => {
            const object = await storage.get(key);

            if (!object) return null;

            if (object.size > 2_000_000) throw new Error('Reset entity archive exceeds limit');

            return { text: await object.text(), sha256: object.customMetadata?.sha256 ?? '', resetId: object.customMetadata?.resetId ?? '', entityId: object.customMetadata?.entityId ?? '' };
          },
          create: async (key, text, metadata) => { await storage.put(key, text, { onlyIf: { etagDoesNotMatch: '*' }, customMetadata: { ...metadata, visibility: 'private' } }); },
          export: () => agent.exportPrivateState(),
          import: snapshot => agent.importPrivateState(snapshot),
        });

        await world.confirmSharedWorkReset(event.instanceId, [archive]);

        return archive;
      });

      const baseline = await step.do('publish-platform-hello-world', options, async () => baselineDeploymentSchema.parse(await execution.bootstrapVisitorBaseline(event.instanceId)));

      return step.do('save-shared-reset-result', async () => {
        await world.flushOutbox();

        return JSON.stringify({ operation: request.operation, reset, baseline, ...visitorStatus(await world.inspect()) });
      });
    }

    return step.do(`staging-${request.operation}`, { retries: { limit: 0, delay: '1 second' }, timeout: '10 minutes' }, async () => {
      if (['evaluate', 'activate', 'resume', 'wake', 'verify-turn', 'visitor-step', 'visitor-configure'].includes(request.operation)) assertEvaluationRelease(await world.evaluationFingerprint());

      if (request.operation === 'visitor-configure') {
        const current = await world.inspect();

        if (Object.keys(visitorAgentCaps).some(id => !current.entities.some(entity => entity.id === id))) throw new Error('Visitor population does not match approved configuration');
        await world.command({ role: 'operator' }, { type: 'budget.configure', dailyUsd: visitorWorldCap }, `visitor-world-cap-${event.instanceId}`);

        for (const [entityId, dailyUsd] of Object.entries(visitorAgentCaps)) {
          await world.command({ role: 'operator' }, { type: 'budget.entity.configure', entityId, dailyUsd }, `visitor-cap-${entityId}-${event.instanceId}`);
        }

        return JSON.stringify({ operation: request.operation, ...visitorStatus(await world.inspect()) });
      }

      if (request.operation === 'visitor-status') {
        const current = await world.inspect();
        const fingerprints = [];
        const agents = this.env.ENTITY_AGENT;

        if (agents) for (const entity of current.entities) {
          const agent = await getAgentByName(agents, entity.id);
          fingerprints.push({ entityId: entity.id, fingerprint: await agent.evaluationFingerprint() });
        }

        return JSON.stringify({ operation: request.operation, ...visitorStatus(current), callerFingerprint: releaseFingerprint, authorityFingerprint: await world.evaluationFingerprint(), agentFingerprints: fingerprints });
      }

      if (request.operation === 'visitor-step') {
        const agents = this.env.ENTITY_AGENT;

        if (!agents) throw new Error('Visitor runtime binding required');
        const candidates = visitorStepCandidates(await world.inspect(), event.instanceId);
        let outcome: { entityId: string; lane: 'governance' | 'build'; status: string } | null = null;

        for (const candidate of candidates) {
          const agent = await getAgentByName(agents, candidate.entityId);
          assertEvaluationRelease(await agent.evaluationFingerprint());
          const recovery = await agent.recoveryStatus();

          if (recovery.blocked || recovery.running && !recovery.leaseExpired || candidate.lane === 'governance' && recovery.pending && !recovery.governancePending) continue;

          try {
            const status = z.enum(['pending', 'completed', 'blocked', 'step_limit']).parse(candidate.lane === 'governance' || recovery.governancePending ? await agent.runGovernance() : await agent.runLive());
            await world.noteOperation(turnOutcomeMetric(status));
            outcome = { ...candidate, status };
          } catch {
            await world.noteOperation('entity.turn_failure');
            outcome = { ...candidate, status: 'failed' };
          }

          break;
        }

        await world.flushOutbox();

        return JSON.stringify({ operation: request.operation, workflowId: event.instanceId, outcome, ...visitorStatus(await world.inspect()) });
      }

      if (request.operation === 'evaluate') {
        const response = await handleEvaluations(new Request('https://staging-operator.invalid/evaluations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: event.instanceId, allowanceUsd: 0.1, acknowledge: request.acknowledgement }),
        }), this.env, world);

        return JSON.stringify(await response.json<ModelEvaluation>());
      }

      if (request.operation === 'verify-turn') {
        const current = await world.inspect();
        const agents = this.env.ENTITY_AGENT;

        if (!agents || current.mode !== 'live' || current.paused || current.goals.some(goal => !['completed', 'cancelled'].includes(goal.status))) throw new Error('Runtime check requires an active live world with no unfinished goal');
        const results = [];

        for (const entityId of ['builder-1']) {
          const agent = await getAgentByName(agents, entityId);

          try {
            assertEvaluationRelease(await agent.evaluationFingerprint());
            const status = z.enum(['pending', 'completed', 'blocked', 'step_limit']).parse(await agent.runLive());
            await world.noteOperation(turnOutcomeMetric(status));
            results.push({ entityId, status });
          } catch (error) {
            await world.noteOperation('entity.turn_failure');
            // Private account-API-only untrusted diagnostics; never model input or public evidence.
            results.push({ entityId, status: 'failed', privateDiagnostic: error instanceof Error ? error.message.slice(0, 300) : 'Unknown runtime failure' });
          }
        }

        await world.flushOutbox();

        return JSON.stringify({ operation: 'verify-turn', workflowId: event.instanceId, results });
      }

      if (request.operation === 'probe') {
        let stage = 'binding';

        try {
          const execution = this.env.EXECUTION;

          if (!execution) throw new Error('Repository probe failed');
          const entityId = 'researcher';
          const taskId = 'personal-staging-probe';
          stage = 'repo.fork';
          const fork = z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/) }).parse(JSON.parse(await execution.execute(entityId, 'repo.fork', JSON.stringify({ taskId }))));
          stage = 'repo.read';
          const content = await execution.execute(entityId, 'repo.read', JSON.stringify({ taskId, commit: fork.commit, path: 'site/worker.ts' }));
          stage = 'repo.patch_commit';
          const result = await execution.execute(entityId, 'repo.patch_commit', JSON.stringify({ taskId, path: 'site/worker.ts', content, message: 'Verify scoped repository edit transport' }));
          z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/) }).parse(JSON.parse(result));

          return JSON.stringify({ stage, success: true, entityId, taskId, buildRequested: false });
        } catch (error) {
          return JSON.stringify({ stage, success: false, code: 'repository-probe-failed', message: probeError(error instanceof Error ? error.message : '') });
        }
      }

      if (request.operation === 'diagnostics') {
        const agents = this.env.ENTITY_AGENT;

        if (!agents) throw new Error('Agent runtime binding required');
        const entities = [];

        for (const entityId of ['builder-1']) {
          const agent = await getAgentByName(agents, entityId);
          const memory = await agent.readMemory();
          let snapshotExportable: boolean | null = null;
          let continuation: { steps: number; failures: number; inFlightTool: string | null; queuedTools: string[]; personal: boolean } | null = null;

          if ((await world.inspect()).paused) {
            try { const snapshot = await agent.exportPrivateState(); snapshotExportable = true;
              const saved = snapshot.state.continuation;

              if (saved) continuation = { steps: saved.slice.steps, failures: saved.slice.failures, inFlightTool: saved.slice.inFlight?.name ?? null, queuedTools: saved.slice.calls.map(call => call.name), personal: saved.personal !== null };
            } catch { snapshotExportable = false; }
          }

          entities.push({ entityId, snapshotExportable, continuation, recovery: await agent.recoveryStatus(), fingerprint: await agent.evaluationFingerprint(), ...turnDiagnostics(memory.entries) });
        }

        return JSON.stringify({ source: 'private-memory-aggregates', independentlyVerifiedOutcomes: false, entities });
      }

      if (request.operation === 'configure') {
        await world.command({ role: 'operator' }, { type: 'budget.configure', dailyUsd: stagingWorldCap }, 'staging-setup-world-cap-v1');

        for (const [entityId, dailyUsd] of Object.entries(stagingAgentCaps)) {
          await world.command({ role: 'operator' }, { type: 'budget.entity.configure', entityId, dailyUsd }, `staging-setup-cap-${entityId}-${dailyUsd}-v2`);
        }
      }

      if (request.operation === 'activate') await world.activateLive(stagingWorldCap, request.acknowledgement, releaseFingerprint);

      if (request.operation === 'backup-probe') {
        const barrier = (await world.operations()).recoveryBarrier;
        const execution = this.env.EXECUTION;

        if (!barrier || barrier.startsWith('restore-') || !(await world.inspect()).paused || !execution) throw new Error('Paused backup required');

        let entityId = 'steward';
        let stage: 'git' | 'application' = 'git';

        try {
          for (const id of Object.keys(stagingAgentCaps)) {
            entityId = id; stage = 'git';
            await execution.exportCanonical(entityId, barrier);
            stage = 'application';
            await execution.exportApplicationData(entityId, barrier);
          }

          return JSON.stringify({ operation: 'backup-probe', success: true, entities: 6 });
        } catch (error) {
          // Account-API-only untrusted operational text; retain privately and never use as model input.
          return JSON.stringify({ operation: 'backup-probe', success: false, entityId, stage, message: error instanceof Error ? error.message.slice(0, 300) : 'Unknown transport error' });
        }
      }

      if (request.operation === 'backup') backupOutcome = await world.backup(Date.now());

      if (request.operation === 'pause' || request.operation === 'resume') {
        const current = await world.inspect();

        if (current.mode !== 'live') throw new Error('Setup pause and resume require a live world');

        // Existing activation authority checks the deployed model pin even for an already-live world.
        if (request.operation === 'resume') await world.activateLive(stagingWorldCap, 'ENABLE_LIVE_WORLD', releaseFingerprint);

        await world.command({ role: 'operator' }, { type: 'world.pause', paused: request.operation === 'pause' }, `staging-setup-${request.operation}-${event.instanceId}`);
      }

      if (request.operation === 'wake') {
        const current = await world.inspect();
        const agents = this.env.ENTITY_AGENT;

        if (!agents || current.mode !== 'live' || current.paused || current.goals.some(goal => !['completed', 'cancelled'].includes(goal.status))) throw new Error('Setup wake requires an active live world with no unfinished goal');
        const due = current.entities.filter(entity => !entity.lastActiveAt || Date.parse(entity.lastActiveAt) + 30 * 60000 <= Date.now()).sort((left, right) => (left.lastActiveAt ?? '').localeCompare(right.lastActiveAt ?? ''));

        await Promise.all(due.slice(0, 2).map(async entity => {
          const agent = await getAgentByName(agents, entity.id);

          try { await world.noteOperation(turnOutcomeMetric(await agent.runLive())); }
          catch { await world.noteOperation('entity.turn_failure'); }
        }));
        await world.flushOutbox();
      }

      const state = await world.inspect();
      const backups = await this.env.WORLD_BACKUPS?.list({ prefix: 'world/', limit: 100 });
      const freshAuthorityFingerprint = await this.env.WORLD.getByName('release-preflight').evaluationFingerprint();

      return JSON.stringify({ backupOutcome, callerFingerprint: releaseFingerprint, authorityFingerprint: await world.evaluationFingerprint(), freshAuthorityFingerprint, mode: state.mode, paused: state.paused, budget: state.budget, maintenanceReservedUsd: state.reservations.reduce((sum, item) => sum + (item.id.startsWith('maintenance-') ? reservationCommitment(item, state.budget.day) : 0), 0), entities: state.entities.map(entity => ({ id: entity.id, dailyAllowanceUsd: entity.dailyAllowanceUsd, committedUsd: entityDailyCommitment(state, entity.id), lastActiveAt: entity.lastActiveAt })), backups: backups?.objects.map(item => ({ key: item.key, size: item.size })), evaluations: await world.listEvaluations(), operations: await world.operations() });
    });
  }
}

export default { fetch() { return new Response('Not found', { status: 404 }); } };
