import { privateSnapshotSchema } from '../../agent-runtime/features/memory/state';
import { SharedResetLedger, requireBaselineOperation, resetEntityArchiveSchema, type ResetEntityArchive, baselineDeploymentSchema, type SharedResetReceipt } from '../features/visitor-reset/ledger';
import { sharedResetId } from '../../../packages/domain/src/shared-reset';
import { helloWorldBaselineHash } from '../../execution/features/visitor-baseline/content';
import { refreshDailyBudget, reservationCommitment, restoreDailyAccounting } from '../../../packages/domain/src/daily-budget';
import { governanceContext, governanceLane, requireGovernanceAction } from '../features/visitor-governance/governance';
import { publicVisitorGoal, reviewObservationSchema, validateObservation, type ReviewObservation } from '../features/visitor-governance/observation';
import { handleVisitorRequest } from '../features/visitor-http/http';
import { VisitorSessionLedger } from '../features/visitor-http/sessions';
import { releaseFingerprint } from '../generated/release';
/// <reference types="@cloudflare/workers-types" />
import { MaintenanceLedger } from '../features/operations/maintenance';
import { recordLiveTurnOutcome } from '../features/operations/turn-outcome';
import { liveTurnDue, liveCandidateWindow, scheduledAction } from '../features/operations/scheduling';
import { privateAssignment, publicAssignment, authorizePublicAssignment, type PrivateAssignment, type PublicAssignment } from '../features/world-state/assignment';
import { applicationSnapshotSchema } from '../../execution/features/application-services/data';
import { handleEvaluations } from '../features/model-evaluations/http';
import { deliverOperationsAlert } from '../features/operations/alerts';
import { EvaluationLedger, assertEvaluationRelease, type ModelEvaluation } from '../features/model-evaluations/ledger';
import { handleRemoteMcp } from '../features/mcp/server';
import { OperationsLedger, type TrafficKind } from '../features/operations/ledger';
import { digest, digestBytes, validateCompleteBackup, backupExportTargets, repositoryExportSchema, applicationExportSchema, backupProgressSchema, backupCheckpointSchema, validateBackupCheckpoint, validateBackupProgress, type BackupProgress, type BackupProgressContext, type BackupCheckpoint } from '../features/operations/backup';
import type { ExecutionGateway } from '../../execution/src/index';
import { DurableObject } from 'cloudflare:workers';
import { getAgentByName } from 'agents';
import { projectPublicKnowledge, searchPublicKnowledge } from './knowledge';
import { cloudCatalogue, publicCloudCatalogue } from '../../knowledge/generated/catalogue';
import { z } from 'zod';
import { authenticateOperator, operatorOrigin, type AccessConfiguration } from './auth';
import { validateRestore } from './restore';
import { commandEnvelopeSchema } from '../../../packages/contracts/src/index';
import { WorldEngine, parseWorldState } from '../../../packages/domain/src/index';
import { synchronizeEvaluationBudget, assertEvaluationWorldAllowance } from '../../../packages/domain/src/evaluation-budget';
import type { EntityAgent } from '../../agent-runtime/src/worker';
import type { Actor, Command, Deployment, PublicWorld, WorldState, PublicAuthoringScope } from '../../../packages/contracts/src/index';

type ProjectionMessage = { sequence: number; projection: PublicWorld };

type WorldEnvironment = { WORLD: DurableObjectNamespace<WorldDurableObject>; PROJECTIONS?: Queue<ProjectionMessage>; PUBLIC_INDEX?: D1Database; ENTITY_AGENT?: DurableObjectNamespace<EntityAgent>; LIVE_ACTIVATED?: string; DAILY_ALLOWANCE_USD?: string; AUTO_SIMULATION_TICKS?: string; MODEL_EVALUATED?: string; ASSETS?: Fetcher; WORLD_BACKUPS?: R2Bucket; BACKUPS_ENABLED?: string; BACKUP_ENVIRONMENT?: string; BACKUP_ALLOWANCE_USD?: string; WORLD_BUILDS?: R2Bucket; AI?: Ai; EVALUATIONS_ENABLED?: string; EVALUATION_ALLOWANCE_USD?: string; ENVIRONMENT_NAME?: string; MODEL_EVALUATION_ID?: string; ENTITY_DOMAIN?: string; ENTITY_MCP_TOKEN_HASHES?: string; ALERTS_ENABLED?: string; ALERT_DELIVERY_AUTHORIZED?: string; ALERT_WEBHOOK_URL?: string; ALERT_WEBHOOK_HOST?: string; EXECUTION?: Service<ExecutionGateway> } & AccessConfiguration;

const sequenceSchema = z.object({ sequence: z.number().int().positive() });

/** Service binding RPC is internal; HTTP exposes public projection only. */
export class WorldDurableObject extends DurableObject<WorldEnvironment> {
  private resetRunning = false;
  private backupRunning = false;
  private restoreRunning = false;
  private load(): WorldEngine {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_snapshot (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
    const rows = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM world_snapshot WHERE id=1').toArray();

    const snapshot = rows[0] ? parseWorldState(rows[0].value) : undefined;

    if (snapshot?.mode === 'live') { refreshDailyBudget(snapshot); snapshot.clock = new Date().toISOString(); }

    const engine = new WorldEngine(snapshot);
    const projects = engine.getState().projects ?? [];
    const domain = z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/).safeParse(this.env.ENTITY_DOMAIN);

    if (domain.success) {
      const state = engine.getState();
      state.projects = projects.map(project => project.id === 'collective' && !project.hostname ? { ...project, hostname: `collective.${domain.data}` } : project);
      const evaluations = new EvaluationLedger(this.ctx.storage.sql).listAll();

      return new WorldEngine(evaluations.length ? synchronizeEvaluationBudget(state, evaluations, new Date().toISOString()) : state);
    }

    const evaluations = new EvaluationLedger(this.ctx.storage.sql).listAll();

    return evaluations.length ? new WorldEngine(synchronizeEvaluationBudget(engine.getState(), evaluations, new Date().toISOString())) : engine;
  }
  private sharedResetBarrier(): string | null { return new SharedResetLedger(this.ctx.storage.sql).active(); }
  private noPublicationLease(): void {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS publication_lease(entity TEXT PRIMARY KEY, owner TEXT NOT NULL, expiry INTEGER NOT NULL)');

    if (this.ctx.storage.sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM publication_lease WHERE expiry>?', Date.now()).one().total) throw new Error('Publication is still active');
  }
  async resetSharedWebsite(resetId: string, acknowledgement: string): Promise<SharedResetReceipt> {
    sharedResetId.parse(resetId);

    if (acknowledgement !== 'RESET_SHARED_WEBSITE' || !this.env.WORLD_BACKUPS || !this.env.ENTITY_AGENT) throw new Error('Acknowledged private reset storage required');
    const ledger = new SharedResetLedger(this.ctx.storage.sql);
    const existing = ledger.receipt(resetId);

    if (existing) return existing;

    if (this.resetRunning) throw new Error('Shared reset already running');
    this.resetRunning = true;

    try {
      const snapshot = this.inspect();

      if (!snapshot.paused || this.backupRunning || this.restoreRunning) throw new Error('Pause and drain world before resetting');
      this.noPublicationLease();
      const backupBarrier = this.ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=? AND name=?', 'table', 'backup_barrier').toArray().length && this.ctx.storage.sql.exec('SELECT id FROM backup_barrier WHERE id=1').toArray().length;

      if (backupBarrier) throw new Error('Backup or restore is pending');

      for (const entity of snapshot.entities) {
        const agent = await getAgentByName(this.env.ENTITY_AGENT, entity.id);
        const recovery = await agent.recoveryStatus();

        if (recovery.running && !recovery.leaseExpired) throw new Error('Agent turn is still active');
      }

      const source = this.ctx.storage.transactionSync(() => {
        if (!this.inspect().paused) throw new Error('World pause changed');

        if (this.operations().recoveryBarrier) throw new Error('Backup or restore is pending');
        this.noPublicationLease();

        return ledger.begin(resetId, JSON.stringify({ schemaVersion: 1, resetId, createdAt: new Date().toISOString(), world: this.inspect() }));
      });

      if (new TextEncoder().encode(source).byteLength > 20_000_000) throw new Error('Shared reset archive exceeds limit');
      const archiveSha256 = await digest(source);
      const archiveKey = `private-shared-resets/${resetId}.json`;

      if (this.inspect().mode === 'live') this.ctx.storage.transactionSync(() => {
        const state = this.inspect();
        const committed = state.reservations.reduce((sum, item) => sum + (item.id.startsWith(`platform-baseline:${resetId}:`) ? item.status === 'reserved' ? item.estimatedUsd : item.actualUsd ?? 0 : 0), 0);

        if (committed + 0.001 > 0.05) throw new Error('Reset preparation allowance exhausted');
        const engine = new WorldEngine(state); engine.reservePlatformBaseline(0.001, `platform-baseline:${resetId}:archive:${crypto.randomUUID()}`); this.save(engine);
      });

      await this.env.WORLD_BACKUPS.put(archiveKey, source, { onlyIf: { etagDoesNotMatch: '*' }, customMetadata: { visibility: 'private', resetId, sha256: archiveSha256 } });
      const retained = await this.env.WORLD_BACKUPS.get(archiveKey);

      if (!retained || retained.size > 20_000_000 || await digest(await retained.text()) !== archiveSha256) throw new Error('Saved private reset archive was not verified');
      const receipt: SharedResetReceipt = { resetId, archiveKey, archiveSha256, status: 'reset', workCleared: false, entityArchives: [] };
      this.ctx.storage.transactionSync(() => {
        if (ledger.active() !== resetId || !this.inspect().paused) throw new Error('Reset authority changed');
        this.noPublicationLease();
        const engine = this.load(); engine.resetSharedWebsite(); this.save(engine); ledger.save(receipt);
      });
      this.ctx.waitUntil(this.flushOutbox());

      return receipt;
    } finally { this.resetRunning = false; }
  }
  authorizeResetEntity(resetId: string, entityId: string): void {
    sharedResetId.parse(resetId);
    const state = this.inspect();
    const ledger = new SharedResetLedger(this.ctx.storage.sql);

    if (!state.paused || ledger.active() !== resetId || ledger.receipt(resetId)?.status !== 'reset' || !state.entities.some(item => item.id === entityId)) throw new Error('Paused matching shared reset required');
  }
  async confirmSharedWorkReset(resetId: string, archives: ResetEntityArchive[]): Promise<void> {
    sharedResetId.parse(resetId);
    const [proof] = z.array(resetEntityArchiveSchema).length(1).parse(archives);
    this.authorizeResetEntity(resetId, proof.entityId);

    if (!this.env.WORLD_BACKUPS || !this.env.ENTITY_AGENT || proof.key !== `private-shared-resets/${resetId}/entities/${proof.entityId}.json`) throw new Error('Private reset archive required');
    const object = await this.env.WORLD_BACKUPS.get(proof.key);

    if (!object || object.size > 2_000_000) throw new Error('Entity reset archive unavailable');
    const source = await object.text();

    if (await digest(source) !== proof.sha256) throw new Error('Entity reset archive integrity mismatch');
    const original = privateSnapshotSchema.parse(JSON.parse(source));

    if (original.entityId !== proof.entityId) throw new Error('Entity archive identity mismatch');
    const agent = await getAgentByName(this.env.ENTITY_AGENT, proof.entityId);
    const current = await agent.exportPrivateState();
    const state = current.state;

    if (current.entityId !== proof.entityId || state.running || state.leaseUntil !== 0 || state.turnId !== null || state.checkpoint !== 0 || state.continuation != null || state.pendingCommand != null || state.governancePending != null || JSON.stringify(state.entries) !== JSON.stringify(original.state.entries) || state.turns !== original.state.turns) throw new Error('Reset must preserve memory and clear operational work');
    this.ctx.storage.transactionSync(() => {
      this.authorizeResetEntity(resetId, proof.entityId);
      const ledger = new SharedResetLedger(this.ctx.storage.sql); const receipt = ledger.receipt(resetId);

      if (!receipt) throw new Error('Saved reset required');
      const existing = receipt.entityArchives.find(item => item.entityId === proof.entityId);

      if (existing && JSON.stringify(existing) !== JSON.stringify(proof)) throw new Error('Entity reset confirmation conflict');
      const confirmed = existing ? receipt.entityArchives : [...receipt.entityArchives, proof];
      const expected = this.inspect().entities.map(item => item.id);
      ledger.save({ ...receipt, entityArchives: confirmed, workCleared: expected.every(id => confirmed.some(item => item.entityId === id)) });
    });
  }
  authorizeVisitorBaseline(resetId: string, attemptId: string) {
    sharedResetId.parse(resetId); sharedResetId.parse(attemptId);
    const ledger = new SharedResetLedger(this.ctx.storage.sql);
    const receipt = ledger.receipt(resetId);
    const state = this.inspect();
    const project = state.projects?.find(item => item.id === 'collective');

    if (!receipt || !project) throw new Error('Saved shared reset required');

    if (receipt.status === 'published' && receipt.deployment) return { projectId: 'collective' as const, repository: project.repository, deployment: receipt.deployment };

    if (!receipt.workCleared || this.env.LIVE_ACTIVATED !== 'true' || this.env.MODEL_EVALUATED !== 'true' || !(Number(this.env.DAILY_ALLOWANCE_USD) > 0) || ledger.active() !== resetId || !state.paused || state.mode !== 'live' || project.siteVersion !== 0) throw new Error('Paused live reset window required');
    new EvaluationLedger(this.ctx.storage.sql).assertPassed(this.env.MODEL_EVALUATION_ID, this.env.ENVIRONMENT_NAME);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS publication_lease(entity TEXT PRIMARY KEY,owner TEXT NOT NULL,expiry INTEGER NOT NULL)');
    const owner = `baseline-${attemptId}`;
    const lease = this.ctx.storage.sql.exec<{ owner: string; expiry: number }>('SELECT owner,expiry FROM publication_lease WHERE entity=?', 'project:collective').toArray()[0];

    if (lease && lease.owner !== owner && lease.expiry > Date.now()) throw new Error('Baseline publication is occupied');
    this.ctx.storage.sql.exec('INSERT INTO publication_lease(entity,owner,expiry) VALUES(?,?,?) ON CONFLICT(entity) DO UPDATE SET owner=excluded.owner,expiry=excluded.expiry', 'project:collective', owner, Date.now() + 15 * 60000);

    return { projectId: 'collective' as const, repository: project.repository, deployment: null };
  }
  private requireVisitorBaseline(resetId: string, attemptId: string): void {
    const state = this.inspect();
    const lease = this.ctx.storage.sql.exec<{ owner: string; expiry: number }>('SELECT owner,expiry FROM publication_lease WHERE entity=?', 'project:collective').toArray()[0];

    if (this.env.LIVE_ACTIVATED !== 'true' || this.env.MODEL_EVALUATED !== 'true' || !(Number(this.env.DAILY_ALLOWANCE_USD) > 0) || this.sharedResetBarrier() !== resetId || !state.paused || state.mode !== 'live' || state.projects?.find(item => item.id === 'collective')?.siteVersion !== 0 || lease?.owner !== `baseline-${attemptId}` || lease.expiry <= Date.now()) throw new Error('Baseline publication authority changed');
    new EvaluationLedger(this.ctx.storage.sql).assertPassed(this.env.MODEL_EVALUATION_ID, this.env.ENVIRONMENT_NAME);
  }
  reserveVisitorBaseline(resetId: string, attemptId: string, amount: number, operation: string): { id: string } {
    sharedResetId.parse(resetId); sharedResetId.parse(attemptId);
    requireBaselineOperation(operation);
    z.number().finite().positive().max(0.05).parse(amount);

    return this.ctx.storage.transactionSync(() => {
      this.requireVisitorBaseline(resetId, attemptId);
      const state = this.inspect();
      const prefix = `platform-baseline:${resetId}:`;
      const committed = state.reservations.reduce((sum, item) => sum + (item.id.startsWith(prefix) ? item.status === 'settled' ? item.actualUsd ?? item.estimatedUsd : item.status === 'reserved' ? item.estimatedUsd : 0 : 0), 0);

      if (committed + amount > 0.05) throw new Error('Baseline preparation allowance exhausted');
      const engine = new WorldEngine(state); const id = engine.reservePlatformBaseline(amount, `${prefix}${operation}:${crypto.randomUUID()}`); this.save(engine);

      return { id };
    });
  }
  async completeVisitorBaseline(resetId: string, attemptId: string, input: Deployment, baselineHash: string, assertions: string[]): Promise<void> {
    sharedResetId.parse(resetId); sharedResetId.parse(attemptId);
    const deployment = baselineDeploymentSchema.parse(input);
    z.array(z.string().min(1).max(500)).min(6).max(20).parse(assertions);

    if (!['Platform-provided Hello World baseline', 'TypeScript compiled', 'Platform baseline tests passed', 'Independent HTTP smoke passed', 'Staging Hello World HTTP verified', 'Production Hello World HTTP verified'].every(assertion => assertions.includes(assertion))) throw new Error('Fixed platform baseline checks missing');

    if (baselineHash !== await helloWorldBaselineHash() || deployment.id !== `deployment-platform-baseline-${resetId}` || deployment.workerName !== `collective-${deployment.bundleHash}`) throw new Error('Checked fixed platform baseline required');
    this.ctx.storage.transactionSync(() => {
      const ledger = new SharedResetLedger(this.ctx.storage.sql); const receipt = ledger.receipt(resetId);

      if (!receipt) throw new Error('Saved reset receipt required');

      if (receipt.status === 'published') {
        if (JSON.stringify(receipt.deployment) !== JSON.stringify(deployment) || receipt.baselineHash !== baselineHash) throw new Error('Baseline receipt conflict');

        return;
      }

      this.requireVisitorBaseline(resetId, attemptId);
      const state = this.inspect(); const project = state.projects?.find(item => item.id === 'collective');

      if (!project) throw new Error('Collective project required');
      project.siteVersion = 1; state.deployments.push(deployment);
      state.events.push({ id: `platform-baseline-${resetId}`, sequence: state.events.length + 1, type: 'website.baseline', actorId: 'platform', summary: 'Platform-provided Hello World starting page published', visibility: 'public', createdAt: deployment.createdAt });
      this.save(new WorldEngine(state)); ledger.save({ ...receipt, status: 'published', deployment, baselineHash }); ledger.complete(resetId);
      this.ctx.storage.sql.exec('DELETE FROM publication_lease WHERE entity=? AND owner=?', 'project:collective', `baseline-${attemptId}`);
    });
    this.ctx.waitUntil(this.flushOutbox());
  }
  releaseVisitorBaseline(resetId: string, attemptId: string): void {
    sharedResetId.parse(resetId); sharedResetId.parse(attemptId);

    if (!new SharedResetLedger(this.ctx.storage.sql).receipt(resetId)) throw new Error('Saved reset receipt required');
    this.ctx.storage.sql.exec('DELETE FROM publication_lease WHERE entity=? AND owner=?', 'project:collective', `baseline-${attemptId}`);
  }
  inspect(): WorldState { return this.load().getState(); }
  validatePublicText(text: string): void { this.load().validatePublicText(text); }
  publicState(): PublicWorld { return this.load().getPublicState(); }
  publicBuild() { return this.load().getPublicBuild(); }
  visitorSession(hash: string) {
    const session = new VisitorSessionLedger(this.ctx.storage.sql).get(hash);

    return session ? this.load().getState().visitorBuild?.visitors.find(visitor => visitor.id === session.visitorId) ?? null : null;
  }
  onboardVisitor(hash: string, name: string, ipHash: string) {
    if (this.sharedResetBarrier()) throw new Error('Shared website reset is pending');

    return this.ctx.storage.transactionSync(() => {
      const ledger = new VisitorSessionLedger(this.ctx.storage.sql);
      ledger.intake(ipHash, Date.now());
      const engine = this.load();
      const visitor = engine.upsertVisitor(ledger.get(hash)?.visitorId ?? `visitor-${crypto.randomUUID()}`, name);
      ledger.put({ hash, visitorId: visitor.id, expires: Date.now() + 30 * 86400000 });
      this.save(engine);

      return visitor;
    });
  }
  submitVisitorSuggestion(hash: string, text: string, key: string, ipHash: string) {
    if (this.sharedResetBarrier()) throw new Error('Shared website reset is pending');

    return this.ctx.storage.transactionSync(() => {
      const session = new VisitorSessionLedger(this.ctx.storage.sql).get(hash);

      if (!session) throw new Error('Visitor session required');
      const engine = this.load();
      const suggestion = engine.submitSuggestion(session.visitorId, text, key, ipHash);
      this.save(engine);

      return suggestion;
    });
  }
  recordTraffic(entityId: string, kind: TrafficKind, status: number, elapsedMs: number, requestId: string): void {
    const state = this.inspect();

    if (!state.entities.some(entity => entity.id === entityId) && !state.projects?.some(project => project.id === entityId)) throw new Error('Unknown traffic owner');
    this.ctx.storage.transactionSync(() => new OperationsLedger(this.ctx.storage.sql).traffic({ entityId, kind, status, elapsedMs, requestId }));
  }
  recordModelUsage(entityId: string, promptTokens: number, completionTokens: number, requestId: string): void {
    z.object({ promptTokens: z.number().int().nonnegative(), completionTokens: z.number().int().nonnegative(), requestId: z.string().min(1).max(200) }).parse({ promptTokens, completionTokens, requestId });

    if (!this.inspect().entities.some(entity => entity.id === entityId)) throw new Error('Unknown entity');
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS model_usage(id TEXT PRIMARY KEY,entity TEXT NOT NULL,prompt INTEGER NOT NULL,completion INTEGER NOT NULL,created INTEGER NOT NULL)');
      this.ctx.storage.sql.exec('INSERT INTO model_usage(id,entity,prompt,completion,created) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING', requestId, entityId, promptTokens, completionTokens, Date.now());
      const total = this.ctx.storage.sql.exec<{ prompt: number; completion: number }>('SELECT COALESCE(SUM(prompt),0) AS prompt,COALESCE(SUM(completion),0) AS completion FROM model_usage').one();
      const ledger = new OperationsLedger(this.ctx.storage.sql); ledger.note('model.prompt_tokens', total.prompt); ledger.note('model.completion_tokens', total.completion);
    });
  }
  publicAnalytics(): ReturnType<OperationsLedger['analytics']> { return new OperationsLedger(this.ctx.storage.sql).analytics(); }
  noteOperation(name: string, value?: number): void { const ledger = new OperationsLedger(this.ctx.storage.sql);

    if (name === 'projection.applied_sequence' && value !== undefined) value = Math.max(value, ledger.inspect().find(item => item.name === name)?.value ?? 0);

 if (value === undefined) ledger.increment(name); else ledger.note(name, value); }
  operations() {
    const state = this.inspect();
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_outbox(sequence INTEGER PRIMARY KEY,payload TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0)');

    const metrics = new OperationsLedger(this.ctx.storage.sql).inspect();
    const barrier = this.ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=? AND name=?', 'table', 'backup_barrier').toArray().length ? this.ctx.storage.sql.exec<{ backup: string }>('SELECT backup FROM backup_barrier WHERE id=1').toArray()[0]?.backup ?? null : null;
    const applied = metrics.find(item => item.name === 'projection.applied_sequence')?.value ?? 0;
    const latest = this.ctx.storage.sql.exec<{ latest: number }>('SELECT COALESCE(MAX(sequence),0) AS latest FROM world_outbox').one().latest;

    return { metrics, recoveryBarrier: barrier, blockedTasks: state.tasks.filter(task => task.status === 'blocked').length, reservedUsd: state.budget.outstandingReservedUsd ?? 0, projectionLag: Math.max(0, latest - applied), projectionAppliedAt: metrics.find(item => item.name === 'projection.applied_at')?.value ?? null, pendingProjection: this.ctx.storage.sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM world_outbox WHERE delivered=0').one().total };
  }
  governanceContext(entityId: string) { return governanceContext(this.inspect(), entityId); }
  async recordReviewObservation(input: ReviewObservation): Promise<void> {
    const observation = reviewObservationSchema.parse(input);
    const bytes = new TextEncoder().encode(observation.content);
    const contentHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    this.ctx.storage.transactionSync(() => {
      const state = this.inspect(); validateObservation(state, observation);
      const engine = new WorldEngine(state);
      engine.recordReviewObservation({ id: observation.id, reviewerId: observation.reviewerId, goalId: observation.goalId, revision: observation.revision, deploymentId: observation.deploymentId, commit: observation.commit, createdAt: observation.createdAt, contentHash, environment: 'production' });
      this.save(engine);
    });
  }
  noteVisitorReviewBlocker(entityId: string, goalId: string, revision: number): void {
    this.ctx.storage.transactionSync(() => {
      const engine = this.load(); engine.noteVisitorReviewBlocker(entityId, goalId, revision); this.save(engine);
    });
    this.ctx.waitUntil(this.flushOutbox());
  }
  governanceCommand(entityId: string, command: Command, key: string): WorldState | null {
    if (!key.startsWith('visitor-governance-') || !command.type.startsWith('suggestion.')) throw new Error('Invalid governance delivery');
    // Preflight is pure. A confirmed obsolete/rejected command can be discarded;
    // actual storage/transport failures below remain unknown and must retain the key.
    const state = this.inspect();

    try {
      if (!Object.hasOwn(state.processedCommands, key)) {
        const context = governanceContext(state, entityId);

        if (!context) return null;
        requireGovernanceAction(context.action, command);
      }

      new WorldEngine(state).dispatch({ role: 'entity', entityId }, command, key);
    } catch { return null; }

    return this.applyCommand({ role: 'entity', entityId }, command, key, false);
  }
  conversation(entityId: string, command: Command, key: string): WorldState {
    return this.applyCommand({ role: 'entity', entityId }, command, key, true);
  }
  command(actor: Actor, command: Command, key: string): WorldState {
    return this.applyCommand(actor, command, key, false);
  }
  private applyCommand(actor: Actor, command: Command, key: string, conversation: boolean): WorldState {
    if (command.type === 'budget.reconcile' && command.reservationId.startsWith('platform-evaluation:') && new EvaluationLedger(this.ctx.storage.sql).get(command.reservationId.slice('platform-evaluation:'.length))?.status === 'running') throw new Error('Running evaluation cannot be reconciled');

    const sharedReset = this.sharedResetBarrier();

    if (sharedReset && !(actor.role === 'operator' && (['budget.configure', 'budget.entity.configure', 'budget.reconcile'].includes(command.type) || command.type === 'world.pause' && command.paused))) throw new Error('Shared website reset is pending');

    const hasBarrier = this.ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=? AND name=?', 'table', 'backup_barrier').toArray().length && this.ctx.storage.sql.exec('SELECT id FROM backup_barrier WHERE id=1').toArray().length;

    if (hasBarrier) {
      const maintenanceControl = actor.role === 'operator' && (['budget.configure', 'budget.entity.configure', 'budget.reconcile'].includes(command.type) || (command.type === 'world.pause' && command.paused));

      if (!maintenanceControl) throw new Error('World backup or restore is draining; work commands are temporarily frozen');

    }

    const state = this.ctx.storage.transactionSync(() => {
      const snapshot = this.inspect();

      if (conversation && (snapshot.mode !== 'live' || snapshot.paused || snapshot.goals.some(goal => !['completed', 'cancelled'].includes(goal.status)) || actor.role !== 'entity' || command.type !== 'social.post')) throw new Error('Public conversation is not authorized');

      if (snapshot.mode === 'live') snapshot.clock = new Date().toISOString();
      const engine = new WorldEngine(snapshot);
      const state = engine.dispatch(actor, command, key);

      if (hasBarrier && command.type === 'world.pause') this.ctx.storage.sql.exec('UPDATE backup_barrier SET resume=0 WHERE id=1');
      this.save(engine);

      return state;
    });

    this.ctx.waitUntil(this.flushOutbox());

    if (command.type === 'world.pause' && !command.paused) this.ctx.waitUntil(this.releaseApplicationFreezes());

    return state;
  }
  private save(engine: WorldEngine): void {
    const state = engine.getState();
    this.ctx.storage.sql.exec('INSERT INTO world_snapshot(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify(state));
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_outbox (sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS projection_cursor (id INTEGER PRIMARY KEY, sequence INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('INSERT INTO projection_cursor(id,sequence) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET sequence=sequence+1');
    const sequence = this.ctx.storage.sql.exec<{ sequence: number }>('SELECT sequence FROM projection_cursor WHERE id=1').one().sequence;
    this.ctx.storage.sql.exec('INSERT INTO world_outbox(sequence,payload) VALUES(?,?)', sequence, JSON.stringify({ sequence, projection: engine.getPublicState() }));
  }
  async alertOperations(): Promise<void> {
    if (this.env.ALERTS_ENABLED !== 'true' || this.env.ALERT_DELIVERY_AUTHORIZED !== 'true') return;
    const operations = this.operations();
    const failures = operations.metrics.filter(item => /failure|dead_letters/.test(item.name)).reduce((total, item) => total + item.value, 0);
    const signature = JSON.stringify({ blockedTasks: operations.blockedTasks, projectionLag: operations.projectionLag, failures });
    const previous = await this.ctx.storage.get<{ signature: string; at: number }>('last-alert');

    if (previous?.signature === signature || (previous && previous.at + 3600000 > Date.now())) return;

    if (!operations.blockedTasks && !operations.projectionLag && !failures) return;

    try {
      const delivered = await deliverOperationsAlert({ enabled: true, deliveryAuthorized: true, url: this.env.ALERT_WEBHOOK_URL, allowedHost: this.env.ALERT_WEBHOOK_HOST }, { type: 'arti.operations', environment: this.env.ENVIRONMENT_NAME ?? 'unconfigured', blockedTasks: operations.blockedTasks, projectionLag: operations.projectionLag, pendingProjection: operations.pendingProjection, failures });

      if (delivered) await this.ctx.storage.put('last-alert', { signature, at: Date.now() });
    } catch { this.noteOperation('alert.failure'); }
  }
  private reserveMaintenance(entityId: string): void {
    if (this.env.LIVE_ACTIVATED !== 'true' || this.env.BACKUPS_ENABLED !== 'true') throw new Error('Live maintenance is not configured');
    this.ctx.storage.transactionSync(() => {
      const state = this.inspect(); state.clock = new Date().toISOString();
      const day = state.clock.slice(0, 10);
      const committed = state.reservations.reduce((total, item) => total + (item.id.startsWith('maintenance-') ? reservationCommitment(item, day) : 0), 0);
      const id = `maintenance-${crypto.randomUUID()}`;
      new MaintenanceLedger(this.ctx.storage.sql).reserve(id, entityId, 0.01, Number(this.env.BACKUP_ALLOWANCE_USD ?? 0), committed);
      const engine = new WorldEngine(state); engine.reserveBudget(entityId, 0.01, id, true); this.save(engine);
    });
  }
  authorizeBackupExport(entityId: string, backupId: string, reserveDispatch: boolean): void {
    const barrier = this.ctx.storage.sql.exec<{ backup: string }>('SELECT backup FROM backup_barrier WHERE id=1').toArray()[0];
    const state = this.inspect();

    if (this.env.BACKUPS_ENABLED !== 'true' || !state.paused || state.mode !== 'live' || barrier?.backup !== backupId || !backupExportTargets(state).includes(entityId)) throw new Error('Backup export is not authorized');

    if (reserveDispatch !== true && reserveDispatch !== false) throw new Error('Explicit backup dispatch intent required');

    if (reserveDispatch) this.reserveMaintenance(state.entities.some(entity => entity.id === entityId) ? entityId : 'steward');
  }
  async backup(scheduledTime: number): Promise<'pending' | 'completed' | undefined> {
    if (this.backupRunning || this.restoreRunning || this.resetRunning || this.sharedResetBarrier()) return;
    this.backupRunning = true;

    try { return await this.performBackup(scheduledTime); } finally { this.backupRunning = false; }
  }
  private async performBackup(scheduledTime: number): Promise<'pending' | 'completed' | undefined> {
    if (this.env.BACKUPS_ENABLED !== 'true' || !this.env.WORLD_BACKUPS || !this.env.ENTITY_AGENT || !this.env.BACKUP_ENVIRONMENT) return;
    const requestedDay = new Date(scheduledTime).toISOString().slice(0, 10);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS backup_barrier(id INTEGER PRIMARY KEY,backup TEXT NOT NULL,resume INTEGER NOT NULL)');
    const existing = this.ctx.storage.sql.exec<{ backup: string; resume: number }>('SELECT backup,resume FROM backup_barrier WHERE id=1').toArray()[0];

    if (existing?.backup.startsWith('restore-')) return;

    if (!existing && await this.ctx.storage.get<string>('last-backup-day') === requestedDay) return;
    const backupId = existing?.backup ?? String(scheduledTime);
    const createdAt = new Date(Number(backupId)).toISOString();
    const day = createdAt.slice(0, 10);
    const progressKey = `backup-progress:${backupId}`;

    if (!existing) this.ctx.storage.transactionSync(() => {
      const engine = this.load(); const resume = !engine.getState().paused;
      this.ctx.storage.sql.exec('INSERT INTO backup_barrier(id,backup,resume) VALUES(1,?,?)', backupId, Number(resume));
      engine.dispatch({ role: 'operator' }, { type: 'world.pause', paused: true }, `backup-pause-${backupId}`); this.save(engine);
    });

    let stage: 'snapshot' | 'git' | 'application' | 'manifest' = 'snapshot';

    try {
      const state = this.inspect();

      if (!state.paused) throw new Error('Backup world must remain paused');
      const context: BackupProgressContext = { id: backupId, environment: this.env.BACKUP_ENVIRONMENT, mode: state.mode, exportScope: state.projects?.length ? 'projects' : 'entities', entityIds: state.entities.map(entity => entity.id) };
      const stored = await this.ctx.storage.get(progressKey);
      const checkpoint: BackupCheckpoint = stored === undefined ? { schemaVersion: 1, ...context, createdAt, rows: [] } : validateBackupCheckpoint(backupCheckpointSchema.parse(stored), context);
      const rows: BackupProgress['rows'] = [];

      for (const reference of checkpoint.rows) {
        const object = await this.env.WORLD_BACKUPS.get(reference.key);

        if (!object || object.size > 16_000_000) throw new Error('Private backup checkpoint object unavailable');
        const source = await object.text();

        if (await digest(source) !== reference.sha256) throw new Error('Private backup checkpoint checksum mismatch');
        rows.push(backupProgressSchema.shape.rows.element.parse(JSON.parse(source)));
      }

      const progress = await validateBackupProgress({ ...checkpoint, rows }, context);
      const entityId = context.entityIds[progress.rows.length];

      if (entityId) {
        const agent = await getAgentByName(this.env.ENTITY_AGENT, entityId);
        stage = 'snapshot';
        const payload = await agent.exportPrivateState();
        const row: BackupProgress['rows'][number] = { entityId, memory: { payload, sha256: await digest(JSON.stringify(payload)) } };

        if (state.mode === 'live' && context.exportScope === 'entities') {
          if (!this.env.EXECUTION) throw new Error('Git export service binding required');
          stage = 'git';
          row.repository = repositoryExportSchema.parse({ entityId, ...await this.env.EXECUTION.exportCanonical(entityId, backupId) });
          stage = 'application';
          row.application = applicationExportSchema.parse({ entityId, ...await this.env.EXECUTION.exportApplicationData(entityId, backupId) });
        }

        progress.rows.push(row);
        await validateBackupProgress(progress, context);
        const source = JSON.stringify(row);
        const key = `progress/${backupId}/${entityId}.json`;
        await this.env.WORLD_BACKUPS.put(key, source, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' }, customMetadata: { visibility: 'private', schemaVersion: '1' } });
        const retained = await this.env.WORLD_BACKUPS.get(key);

        if (!retained) throw new Error('Private backup checkpoint persistence missing');
        const saved = await retained.text();
        progress.rows[progress.rows.length - 1] = backupProgressSchema.shape.rows.element.parse(JSON.parse(saved));
        await validateBackupProgress(progress, context);
        checkpoint.rows.push({ entityId, key, sha256: await digest(saved) });
        validateBackupCheckpoint(checkpoint, context);
        await this.ctx.storage.put(progressKey, checkpoint);

        return 'pending';
      }

      if (progress.rows.length < context.entityIds.length) return 'pending';
      const entities = progress.rows.map(row => row.memory);
      const repositories = progress.rows.flatMap(row => row.repository ? [row.repository] : []);
      const applicationData = progress.rows.flatMap(row => row.application ? [row.application] : []);

      if (state.mode === 'live' && context.exportScope === 'projects') {
        const targets = backupExportTargets(state);
        const retained = z.array(z.object({ repository: repositoryExportSchema, application: applicationExportSchema }).strict()).parse(await this.ctx.storage.get(`backup-project-exports:${backupId}`) ?? []);

        if (JSON.stringify(retained.map(row => row.repository.entityId)) !== JSON.stringify(targets.slice(0, retained.length)) || retained.some(row => row.repository.entityId !== row.application.entityId || row.repository.key !== `git-backups/${backupId}/${row.repository.entityId}.bundle` || row.application.key !== `app-backups/${backupId}/${row.application.entityId}.json`)) throw new Error('Shared project backup checkpoint mismatch');
        const target = targets[retained.length];

        if (target) {
          if (!this.env.EXECUTION) throw new Error('Project export service required');
          stage = 'git';
          const repository = repositoryExportSchema.parse({ entityId: target, ...await this.env.EXECUTION.exportCanonical(target, backupId) });
          stage = 'application';
          const application = applicationExportSchema.parse({ entityId: target, ...await this.env.EXECUTION.exportApplicationData(target, backupId) });
          retained.push({ repository, application });
          await this.ctx.storage.put(`backup-project-exports:${backupId}`, retained);

          return 'pending';
        }

        repositories.push(...retained.map(row => row.repository));
        applicationData.push(...retained.map(row => row.application));
      }

      stage = 'manifest';
      const manifest = { schemaVersion: 2, id: backupId, environment: this.env.BACKUP_ENVIRONMENT, createdAt, world: JSON.stringify(this.inspect()), entities, repositories, applicationData };
      await validateCompleteBackup(JSON.stringify(manifest), this.env.BACKUP_ENVIRONMENT);
      await this.env.WORLD_BACKUPS.put(`world/${day}/${backupId}.json`, JSON.stringify(manifest), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' }, customMetadata: { visibility: 'private', schemaVersion: '2' } });
      const retainedManifest = await this.env.WORLD_BACKUPS.get(`world/${day}/${backupId}.json`);

      if (!retainedManifest) throw new Error('Complete backup persistence missing');
      const savedManifest = await validateCompleteBackup(await retainedManifest.text(), this.env.BACKUP_ENVIRONMENT);

      if (savedManifest.id !== backupId || savedManifest.createdAt !== createdAt || JSON.stringify(savedManifest.world.entities.map(entity => entity.id)) !== JSON.stringify(context.entityIds)) throw new Error('Complete backup persistence scope mismatch');
      await this.ctx.storage.put('last-backup-day', day);
      this.ctx.storage.transactionSync(() => {
        const barrier = this.ctx.storage.sql.exec<{ resume: number }>('SELECT resume FROM backup_barrier WHERE id=1').one();
        this.ctx.storage.sql.exec('DELETE FROM backup_barrier WHERE id=1');

        if (barrier.resume) { const engine = this.load(); engine.dispatch({ role: 'operator' }, { type: 'world.pause', paused: false }, `backup-resume-${backupId}`); this.save(engine); }
      });

      if (!this.inspect().paused) await this.releaseApplicationFreezes();
      await this.ctx.storage.delete(progressKey);
      this.noteOperation('backup.success');

      return 'completed';
    } catch (error) { this.noteOperation('backup.failure'); this.noteOperation(`backup.failure.${stage}`); throw error; /* Private errors remain internal; pre-finalization failures retain the recovery barrier. */ }
  }
  applicationWritesAllowed(): boolean {
    const state = this.inspect();

    if (state.paused || state.mode !== 'live') return false;

    return !this.ctx.storage.sql.exec('SELECT name FROM sqlite_master WHERE type=? AND name=?', 'table', 'backup_barrier').toArray().length || !this.ctx.storage.sql.exec('SELECT id FROM backup_barrier WHERE id=1').toArray().length;
  }
  async releaseApplicationFreezes(): Promise<void> {
    if (!this.env.EXECUTION || !this.applicationWritesAllowed()) return;

    for (const entity of this.inspect().entities) await this.env.EXECUTION.releaseApplicationDataFreeze(entity.id);
  }
  authorizeBackupRestore(entityId: string, backupId: string, key: string, sha256: string): void {
    const permit = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM restore_permit WHERE id=1').toArray()[0];
    const repositories = z.array(z.object({ entityId: z.string(), key: z.string(), sha256: z.string() })).parse(JSON.parse(permit?.value ?? '[]'));
    const barrier = this.ctx.storage.sql.exec<{ backup: string }>('SELECT backup FROM backup_barrier WHERE id=1').toArray()[0];

    if (!this.inspect().paused || barrier?.backup !== `restore-${backupId}` || !repositories.some(item => item.entityId === entityId && item.key === key && item.sha256 === sha256)) throw new Error('Restore export is not authorized');
    this.reserveMaintenance(entityId);
  }
  async restoreCompleteBackup(input: string): Promise<WorldState> {
    if (this.sharedResetBarrier()) throw new Error('Shared website reset is pending');

    if (this.restoreRunning || this.backupRunning || this.resetRunning) throw new Error('Recovery operation already running');
    this.restoreRunning = true;

    try { return await this.performRestore(input); } finally { this.restoreRunning = false; }
  }
  private async performRestore(input: string): Promise<WorldState> {
    if (!this.inspect().paused || !this.env.ENTITY_AGENT || !this.env.WORLD_BACKUPS || !this.env.BACKUP_ENVIRONMENT) throw new Error('Restore requires paused configured world');
    const manifest = await validateCompleteBackup(input, this.env.BACKUP_ENVIRONMENT);

    if (manifest.world.mode === 'live') new EvaluationLedger(this.ctx.storage.sql).assertPassed(this.env.MODEL_EVALUATION_ID, this.env.ENVIRONMENT_NAME);
    validateRestore(JSON.stringify(manifest.world), true, this.env.LIVE_ACTIVATED === 'true' && this.env.MODEL_EVALUATED === 'true');

    for (const deployment of manifest.world.deployments) {
      if (deployment.environment === 'simulation') continue;
      const bundle = await this.env.WORLD_BUILDS?.get(`bundles/${deployment.bundleHash}.js`);

      if (!bundle || bundle.size > 1_000_000 || await digestBytes(await bundle.arrayBuffer()) !== deployment.bundleHash) throw new Error('Retained immutable deployment bundle missing');
    }

    for (const repository of manifest.repositories) {
      const object = await this.env.WORLD_BUILDS?.get(repository.key);

      if (!object || object.size > 100_000_000 || await digestBytes(await object.arrayBuffer()) !== repository.sha256) throw new Error('Git export checksum unavailable');
    }

    for (const snapshot of manifest.applicationData) {
      const object = await this.env.WORLD_BUILDS?.get(snapshot.key);

      if (!object || object.size > 40_000_000) throw new Error('Application backup unavailable');
      const text = await object.text();

      if (await digest(text) !== snapshot.sha256) throw new Error('Application backup checksum mismatch');
      applicationSnapshotSchema.parse(JSON.parse(text));
    }

    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS backup_barrier(id INTEGER PRIMARY KEY,backup TEXT NOT NULL,resume INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('INSERT INTO backup_barrier(id,backup,resume) VALUES(1,?,0) ON CONFLICT(id) DO UPDATE SET backup=excluded.backup,resume=0', `restore-${manifest.id}`);

    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS restore_permit(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
    this.ctx.storage.sql.exec('INSERT INTO restore_permit(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify([...manifest.repositories, ...manifest.applicationData]));

    for (const repository of manifest.repositories) {
      if (!this.env.EXECUTION) throw new Error('Git restore service required');
      await this.env.EXECUTION.restoreCanonical(repository.entityId, manifest.id, repository);
    }

    for (const snapshot of manifest.applicationData) {
      if (!this.env.EXECUTION) throw new Error('Application restore service required');
      await this.env.EXECUTION.restoreApplicationData(snapshot.entityId, manifest.id, snapshot);
    }

    for (const snapshot of manifest.entities) {
      const agent = await getAgentByName(this.env.ENTITY_AGENT, snapshot.payload.entityId);
      await agent.importPrivateState(snapshot.payload);
    }

    const state = this.restoreBackup(JSON.stringify(manifest.world));
    this.ctx.storage.sql.exec('DELETE FROM backup_barrier WHERE id=1');
    this.ctx.storage.sql.exec('DELETE FROM restore_permit WHERE id=1');
    this.noteOperation('restore.success');

    return state;
  }
  restoreBackup(input: string): WorldState {
    if (this.sharedResetBarrier()) throw new Error('Shared website reset is pending');
    const current = this.inspect();
    const state = validateRestore(input, current.paused, this.env.LIVE_ACTIVATED === 'true' && this.env.MODEL_EVALUATED === 'true');

    // Evaluation can incur real provider commitments while the world is simulated.
    // Restoring any mode must preserve saved liabilities and current operator caps.
    restoreDailyAccounting(state, current);

    if (current.mode === 'live') state.clock = new Date().toISOString();
    const reservations = new Map(state.reservations.map(item => [item.id, item]));

    for (const item of current.reservations) reservations.set(item.id, item);
    state.reservations = [...reservations.values()];
    state.budget.dailyUsd = current.budget.dailyUsd;
    refreshDailyBudget(state);

    for (const entity of state.entities) entity.dailyAllowanceUsd = current.entities.find(item => item.id === entity.id)?.dailyAllowanceUsd ?? 0;

    this.ctx.storage.transactionSync(() => {
      this.save(new WorldEngine(state));
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS publication_lease(entity TEXT PRIMARY KEY, owner TEXT NOT NULL, expiry INTEGER NOT NULL)');
      this.ctx.storage.sql.exec('DELETE FROM publication_lease WHERE 1=1');
    });
    this.ctx.waitUntil(this.flushOutbox());

    return state;
  }
  evaluationFingerprint(): string { return releaseFingerprint; }
  beginEvaluation(id: string, maxUsd: number, expectedFingerprint: string) {
    assertEvaluationRelease(expectedFingerprint);

    return this.ctx.storage.transactionSync(() => {
      const ledger = new EvaluationLedger(this.ctx.storage.sql);
      const now = new Date().toISOString();
      const state = synchronizeEvaluationBudget(this.inspect(), ledger.listAll(), now);

      if (!ledger.get(id)) assertEvaluationWorldAllowance(state, maxUsd);
      const result = ledger.begin(id, maxUsd, { enabled: this.env.EVALUATIONS_ENABLED === 'true', dailyUsd: Number(this.env.EVALUATION_ALLOWANCE_USD ?? 0), environment: this.env.ENVIRONMENT_NAME ?? '' }, now);
      this.save(new WorldEngine(synchronizeEvaluationBudget(state, ledger.listAll(), now)));

      return result;
    });
  }
  reserveEvaluation(id: string, operation: string, estimate: number): void { this.ctx.storage.transactionSync(() => new EvaluationLedger(this.ctx.storage.sql).reserve(id, operation, estimate, new Date().toISOString())); }
  authorizeEvaluation(id: string, operation: string): void { this.ctx.storage.transactionSync(() => new EvaluationLedger(this.ctx.storage.sql).authorize(id, operation, new Date().toISOString())); }
  finishEvaluation(id: string, cases: ModelEvaluation['cases']): ModelEvaluation {
    return this.ctx.storage.transactionSync(() => {
      const ledger = new EvaluationLedger(this.ctx.storage.sql);
      const result = ledger.finish(id, cases);
      this.save(new WorldEngine(synchronizeEvaluationBudget(this.inspect(), ledger.listAll(), new Date().toISOString())));

      return result;
    });
  }
  listEvaluations(): ModelEvaluation[] { return new EvaluationLedger(this.ctx.storage.sql).list(); }
  activateLive(dailyAllowanceUsd: number, acknowledgement: string, expectedFingerprint: string): WorldState {
    assertEvaluationRelease(expectedFingerprint);

    if (!this.env.PUBLIC_INDEX || !this.env.PROJECTIONS || !this.env.ENTITY_AGENT) throw new Error('Live activation requires D1, projection queue, and entity runtime bindings');

    if (this.env.LIVE_ACTIVATED !== 'true' || this.env.MODEL_EVALUATED !== 'true' || acknowledgement !== 'ENABLE_LIVE_WORLD') throw new Error('Explicit activation and evaluated model configuration required');

    new EvaluationLedger(this.ctx.storage.sql).assertPassed(this.env.MODEL_EVALUATION_ID, this.env.ENVIRONMENT_NAME);

    if (!Number.isFinite(dailyAllowanceUsd) || dailyAllowanceUsd <= 0 || dailyAllowanceUsd > 1000) throw new Error('A positive bounded allowance is required');

    return this.ctx.storage.transactionSync(() => {
      const state = this.load().getState();

      if (state.mode === 'live') {
        if (state.budget.dailyUsd !== dailyAllowanceUsd) throw new Error('Live world allowance changes use budget.configure');

        return state;
      }

      if (!state.entities.some(entity => (entity.dailyAllowanceUsd ?? 0) > 0)) throw new Error('Configure at least one entity allowance before activation');

      if (state.goals.some(goal => !['completed', 'cancelled'].includes(goal.status))) throw new Error('Close simulated goals before live activation');
      state.mode = 'live'; state.budget.dailyUsd = dailyAllowanceUsd; state.clock = new Date().toISOString();

      for (const appointment of state.appointments) appointment.expiresAt = new Date(Date.parse(state.clock) + 7 * 86400000).toISOString();
      state.events.push({ id: `activation-${state.events.length + 1}`, sequence: state.events.length + 1, type: 'world.activated', actorId: 'operator', summary: 'World live mode explicitly activated', createdAt: state.clock, visibility: 'public' });
      this.save(new WorldEngine(state));

 return state;
    });
  }
  ownTask(entityId: string): PrivateAssignment | null { return privateAssignment(this.load().getState(), entityId); }
  ownPublicTask(entityId: string): PublicAssignment | null { return publicAssignment(this.load().getState(), entityId); }
  authorizePublicTurn(entityId: string, scope: PublicAuthoringScope): void { authorizePublicAssignment(this.inspect(), entityId, scope); }
  publicCommand(entityId: string, scope: PublicAuthoringScope, command: Command, key: string): WorldState {
    if (!['task.claim', 'task.submit', 'task.fail', 'social.post'].includes(command.type)) throw new Error('Command unavailable in public authoring session');

    if ('taskId' in command && command.taskId !== scope.taskId) throw new Error('Public command task scope mismatch');

    if ('expectedRevision' in command && command.expectedRevision !== scope.revision) throw new Error('Public command revision mismatch');

    const state = this.ctx.storage.transactionSync(() => {
      const snapshot = this.inspect();

      // A committed command may be retried after its terminal transition.
      // The engine still verifies the original actor and exact command hash.
      if (!Object.hasOwn(snapshot.processedCommands, key)) authorizePublicAssignment(snapshot, entityId, scope);

      const engine = new WorldEngine(snapshot);
      const updated = engine.dispatch({ role: 'entity', entityId }, command, key);
      this.save(engine);

      return updated;
    });

    this.ctx.waitUntil(this.flushOutbox());

    return state;
  }

  completeTaskFromBuild(taskId: string, deploymentId: string, _criteria: string[], assertions: string[], evidenceKey: string): void {
    this.ctx.storage.transactionSync(() => {
      const state = this.load().getState();
      const task = state.tasks.find(item => item.id === taskId);
      const deployment = state.deployments.find(item => item.id === deploymentId && item.environment !== 'simulation' && item.status === 'published');

      if (!task || !deployment || deployment.entityId !== task.entityId || deployment.goalId !== task.goalId || deployment.revision !== task.revision) throw new Error('Build evidence does not match assigned task');
      const goal = state.goals.find(item => item.id === task.goalId);

      if (state.mode !== 'live' || state.paused || !goal || goal.status !== 'active' || goal.revision !== task.revision) throw new Error('Build result superseded');

      if (state.evidence.some(item => item.id === evidenceKey)) return;
      const id = evidenceKey;
      state.evidence.push({ id, goalId: task.goalId, revision: task.revision, taskId: task.id, entityId: task.entityId, criterion: task.title, sourceCommit: deployment.commit, environment: deployment.environment, status: 'verified', assertions: ['Platform build/smoke checks only; arbitrary goal criteria need independent review', ...assertions], createdAt: state.clock, deploymentId });
      task.evidenceIds.push(id); task.status = 'submitted';
      const entity = state.entities.find(item => item.id === task.entityId);

      if (entity) entity.presence = { locationId: entity.id, activity: 'reviewing', summary: 'Awaiting independent review', peers: [], updatedAt: state.clock };
      this.save(new WorldEngine(state));
    });
  }
  noteEntityTurn(entityId: string): void {
    new EvaluationLedger(this.ctx.storage.sql).assertPassed(this.env.MODEL_EVALUATION_ID, this.env.ENVIRONMENT_NAME);
    this.ctx.storage.transactionSync(() => {
      const engine = this.load();
      const state = engine.getState();

      if (state.mode !== 'live' || state.paused) throw new Error('Live activity disabled');
      const entity = state.entities.find(item => item.id === entityId);

      if (!entity) throw new Error('Unknown entity');
      entity.lastActiveAt = new Date().toISOString();
      state.clock = new Date().toISOString();
      this.save(new WorldEngine(state));
    });
  }
  private publicationKey(entityId: string, projectId?: string): string {
    const state = this.inspect();

    if (!state.entities.some(entity => entity.id === entityId)) throw new Error('Unknown entity');

    if (projectId && !state.projects?.some(project => project.id === projectId)) throw new Error('Unknown shared project');

    return projectId ? `project:${projectId}` : entityId;
  }
  acquirePublication(entityId: string, workflowId: string, projectId?: string): boolean {
    const publicationKey = this.publicationKey(entityId, projectId);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS publication_lease(entity TEXT PRIMARY KEY, owner TEXT NOT NULL, expiry INTEGER NOT NULL)');

    return this.ctx.storage.transactionSync(() => {
      const state = this.load().getState();

      if (state.mode !== 'live' || state.paused || !state.entities.some(entity => entity.id === entityId)) throw new Error('Publication requires a live unpaused known entity');
      const rows = this.ctx.storage.sql.exec<{ owner: string; expiry: number }>('SELECT owner,expiry FROM publication_lease WHERE entity=?', publicationKey).toArray();
      const activeOthers = this.ctx.storage.sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM publication_lease WHERE expiry>? AND entity<>?', Date.now(), publicationKey).one().total;

      if (activeOthers >= 2) return false;

      if (rows[0] && rows[0].owner !== workflowId && rows[0].expiry > Date.now()) return false;
      this.ctx.storage.sql.exec('INSERT INTO publication_lease(entity,owner,expiry) VALUES(?,?,?) ON CONFLICT(entity) DO UPDATE SET owner=excluded.owner,expiry=excluded.expiry', publicationKey, workflowId, Date.now() + 15 * 60000);

      return true;
    });
  }
  releasePublication(entityId: string, workflowId: string, projectId?: string): void {
    const publicationKey = this.publicationKey(entityId, projectId);
    this.ctx.storage.sql.exec('DELETE FROM publication_lease WHERE entity=? AND owner=?', publicationKey, workflowId);
  }
  authorizePublication(entityId: string, expectedCommit: string | null, goalId?: string, revision?: number, workflowId?: string, projectId?: string): void {
    const publicationKey = this.publicationKey(entityId, projectId);

    if (workflowId) {
      const lease = this.ctx.storage.sql.exec<{ owner: string; expiry: number }>('SELECT owner,expiry FROM publication_lease WHERE entity=?', publicationKey).toArray()[0];

      if (!lease || lease.owner !== workflowId || lease.expiry <= Date.now()) throw new Error('Publication lease expired');
    }

    const state = this.load().getState();

    if (state.paused || state.mode !== 'live') throw new Error('Live publication disabled');

    if (!state.entities.some(entity => entity.id === entityId)) throw new Error('Unknown entity');

    if (state.projects?.length && !projectId) throw new Error('Personal website publication is retired');
    const last = state.deployments.findLast(deployment => projectId ? deployment.projectId === projectId : !deployment.projectId && deployment.entityId === entityId);

    if ((last?.commit ?? null) !== expectedCommit) throw new Error('Canonical deployment changed');

    if (!goalId && state.goals.some(goal => !['completed', 'cancelled'].includes(goal.status))) throw new Error('Personal publication waits for shared goals to close');

    if (goalId) {
      const goal = state.goals.find(item => item.id === goalId);

      if (!goal || goal.projectId !== projectId || goal.revision !== revision || !['active', 'awaiting_acceptance'].includes(goal.status)) throw new Error('Goal publication superseded');
    }
  }
  completeDeployment(deployment: Deployment, workflowId: string, expectedCommit: string | null, authoringScope?: PublicAuthoringScope): void {
    this.ctx.storage.transactionSync(() => {
      const existing = this.load().getState().deployments.find(item => item.id === deployment.id);

      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(deployment)) throw new Error('Deployment receipt conflict');

        return;
      }

      if (deployment.goalId) {
        if (!authoringScope || deployment.goalId !== authoringScope.goalId || deployment.revision !== authoringScope.revision || deployment.taskId !== authoringScope.taskId || deployment.projectId !== authoringScope.projectId) throw new Error('Deployment public authoring scope required');
        authorizePublicAssignment(this.inspect(), deployment.entityId, authoringScope);
      }

      const rows = this.ctx.storage.sql.exec<{ owner: string; expiry: number }>('SELECT owner,expiry FROM publication_lease WHERE entity=?', this.publicationKey(deployment.entityId, deployment.projectId)).toArray();

      if (!rows[0] || rows[0].owner !== workflowId || rows[0].expiry <= Date.now()) throw new Error('Publication lease expired');
      this.authorizePublication(deployment.entityId, expectedCommit, deployment.goalId, deployment.revision, workflowId, deployment.projectId);
      const engine = this.load(); engine.recordDeployment(deployment); this.save(engine);
    });
    this.ctx.waitUntil(this.flushOutbox());
  }
  authorizeRollback(entityId: string, workflowId: string, expectedCommit: string, projectId?: string): void {
    const publicationKey = this.publicationKey(entityId, projectId);
    const state = this.inspect();
    const lease = this.ctx.storage.sql.exec<{ owner: string; expiry: number }>('SELECT owner,expiry FROM publication_lease WHERE entity=?', publicationKey).toArray()[0];

    if (state.mode !== 'live' || state.paused || lease?.owner !== workflowId || lease.expiry <= Date.now() || state.deployments.findLast(item => projectId ? item.projectId === projectId : !item.projectId && item.entityId === entityId)?.commit !== expectedCommit) throw new Error('Rollback authority changed');
  }
  completeRollback(deployment: Deployment, workflowId: string, expectedCommit: string): void {
    this.ctx.storage.transactionSync(() => {
      const state = this.inspect();
      const existing = state.deployments.find(item => item.id === deployment.id);

      if (existing) { if (JSON.stringify(existing) !== JSON.stringify(deployment)) throw new Error('Rollback receipt conflict');

 return; }

      this.authorizeRollback(deployment.entityId, workflowId, expectedCommit, deployment.projectId);
      const target = state.deployments.find(item => (deployment.projectId ? item.projectId === deployment.projectId : !item.projectId && item.entityId === deployment.entityId) && item.commit === deployment.commit && item.workerName === deployment.workerName && item.bundleHash === deployment.bundleHash && item.environment === 'production');
      const latest = state.deployments.findLast(item => deployment.projectId ? item.projectId === deployment.projectId : !item.projectId && item.entityId === deployment.entityId);

      if (!target || deployment.status !== 'rolled_back' || deployment.version !== (latest?.version ?? 0) + 1 || deployment.goalId || deployment.revision !== undefined || deployment.taskId) throw new Error('Invalid retained rollback result');
      state.deployments.push(deployment);
      const entity = state.entities.find(item => item.id === deployment.entityId);

      const project = deployment.projectId ? state.projects?.find(item => item.id === deployment.projectId) : undefined;

      if (project) project.siteVersion = deployment.version;

      if (entity) { if (!project) entity.siteVersion = deployment.version; entity.presence = { locationId: entity.id, activity: 'publishing', summary: 'Restored a checked release', peers: [], updatedAt: state.clock }; }

      state.events.push({ id: deployment.id, sequence: state.events.length + 1, type: 'deployment.rollback', actorId: 'operator', summary: `${deployment.entityId} restored a retained release`, visibility: 'public', createdAt: deployment.createdAt });
      this.save(new WorldEngine(state));
    });
    this.ctx.waitUntil(this.flushOutbox());
  }
  reserve(entityId: string, amount: number, operation: string): { id: string } {
    new EvaluationLedger(this.ctx.storage.sql).assertPassed(this.env.MODEL_EVALUATION_ID, this.env.ENVIRONMENT_NAME);

    return this.ctx.storage.transactionSync(() => { const state = this.inspect(); state.clock = new Date().toISOString(); const engine = new WorldEngine(state); const id = engine.reserveBudget(entityId, amount, operation); this.save(engine);

 return { id }; });
  }
  settle(id: string, actual: number | null): void {
    if (actual === null) return;
    this.ctx.storage.transactionSync(() => { const state = this.inspect(); state.clock = new Date().toISOString(); const engine = new WorldEngine(state); engine.settleBudget(id, actual); this.save(engine); });
  }
  async flushOutbox(): Promise<void> {
    if (!this.env.PROJECTIONS) return;
    this.load();
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_outbox (sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)');
    const rows = this.ctx.storage.sql.exec<{ sequence: number }>('SELECT sequence FROM world_outbox WHERE delivered=0 ORDER BY sequence LIMIT 100').toArray();

    for (const row of rows) {
      await this.env.PROJECTIONS.send({ sequence: row.sequence, projection: this.publicState() });
      this.ctx.storage.sql.exec('UPDATE world_outbox SET delivered=1 WHERE sequence=?', row.sequence);
    }
  }
}

export default {
  async fetch(request: Request, env: WorldEnvironment): Promise<Response> {
    const path = new URL(request.url).pathname;
    const world = env.WORLD.getByName('arti-world');

    if (path === '/api/v1/mcp') return handleRemoteMcp(request, env);

    if (path === '/api/v1/visitor/session' || path === '/api/v1/visitor/suggestions') return handleVisitorRequest(request, {
      session: hash => world.visitorSession(hash),
      onboard: (hash, name, ipHash) => world.onboardVisitor(hash, name, ipHash),
      suggest: (hash, text, key, ipHash) => world.submitVisitorSuggestion(hash, text, key, ipHash),
    }, request.headers.get('CF-Connecting-IP') ?? 'unavailable');

    if (path === '/api/v1/public/build' && request.method === 'GET') return Response.json(await world.publicBuild(), { headers: { 'Cache-Control': 'no-store' } });

    if (path === '/api/v1/public/knowledge/search' && request.method === 'GET') {
      if (!env.PUBLIC_INDEX) return Response.json({ error: 'Public knowledge index is not configured' }, { status: 503 });

      return Response.json((await searchPublicKnowledge(env.PUBLIC_INDEX, new URL(request.url).searchParams.get('q') ?? '')).results);
    }

    if (path === '/api/v1/public/config' && request.method === 'GET') {
      const configured = z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/).safeParse(env.ENTITY_DOMAIN);

      return Response.json({ entityDomain: configured.success ? configured.data : null });
    }

    if (path === '/api/v1/public/analytics' && request.method === 'GET') return Response.json(await world.publicAnalytics());

    if (path === '/api/v1/public/catalog' && request.method === 'GET') return Response.json(publicCloudCatalogue);

    if (['/api/v1/public', '/api/v1/public/world'].includes(path) && request.method === 'GET') return Response.json(await world.publicState());

    if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });

    try { await authenticateOperator(request, env); } catch { return Response.json({ error: 'Operator authentication required' }, { status: 403 }); }

    if (request.method === 'GET' && path === '/api/v1/evaluations') return handleEvaluations(request, env, world);

    if (request.method === 'GET' && path === '/api/v1/operations') return Response.json(await world.operations(), { headers: { 'Cache-Control': 'no-store' } });

    if (request.method === 'GET' && path === '/api/v1/catalog') return Response.json(cloudCatalogue, { headers: { 'Cache-Control': 'no-store' } });

    if (request.method === 'GET' && path === '/api/v1/session') return Response.json({ authenticated: true, mode: (await world.inspect()).mode });

    if (request.method === 'GET' && path === '/api/v1/backups') return env.WORLD_BACKUPS ? Response.json((await env.WORLD_BACKUPS.list({ prefix: 'world/', limit: 100 })).objects.map(item => ({ key: item.key, uploaded: item.uploaded })), { headers: { 'Cache-Control': 'no-store' } }) : Response.json([]);

    if (request.method === 'GET' && path === '/api/v1/world') return Response.json(await world.inspect(), { headers: { 'Cache-Control': 'no-store' } });

    if (request.method === 'POST') {
      if (!operatorOrigin(request, env)) return Response.json({ error: 'Operator origin required' }, { status: 403 });

      if (Number(request.headers.get('Content-Length') ?? 0) > 32000) return new Response('Body too large', { status: 413 });

      try {
        const body = await request.text();

        if (body.length > 32000) return new Response('Body too large', { status: 413 });

        if (path === '/api/v1/deployments/rollback') {
          if (!env.EXECUTION) throw new Error('Execution service unavailable');
          const rollback = z.object({ entityId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/), deploymentId: z.string().min(1).max(200), acknowledgement: z.literal('ROLLBACK_ENTITY_RELEASE') }).strict().parse(JSON.parse(body));

          return Response.json(await env.EXECUTION.rollback(rollback.entityId, rollback.deploymentId), { headers: { 'Cache-Control': 'no-store' } });
        }

        if (path === '/api/v1/evaluations') return handleEvaluations(new Request(request, { body }), env, world);

        if (path === '/api/v1/commands') {
          const envelope = commandEnvelopeSchema.parse(JSON.parse(body));

          return Response.json(await world.command({ role: 'operator' }, envelope.command, envelope.idempotencyKey), { headers: { 'Cache-Control': 'no-store' } });
        }

        if (path === '/api/v1/backups/restore' && env.WORLD_BACKUPS) {
          const restore = z.object({ acknowledgement: z.literal('RESTORE_WORLD_BACKUP'), key: z.string().regex(/^world\/\d{4}-\d{2}-\d{2}\/\d+\.json$/) }).strict().parse(JSON.parse(body));
          const object = await env.WORLD_BACKUPS.get(restore.key);

          if (!object || object.size > 10_000_000) throw new Error('Backup unavailable or too large');

          return Response.json(await world.restoreCompleteBackup(await object.text()), { headers: { 'Cache-Control': 'no-store' } });
        }

        if (path === '/api/v1/activation') {
          const activation = z.object({ acknowledgement: z.literal('ENABLE_LIVE_WORLD'), dailyAllowanceUsd: z.number().positive().max(1000) }).strict().parse(JSON.parse(body));

          return Response.json(await world.activateLive(activation.dailyAllowanceUsd, activation.acknowledgement, releaseFingerprint), { headers: { 'Cache-Control': 'no-store' } });
        }
      } catch { return Response.json({ error: 'Command rejected; inspect current revision, permissions, and configuration' }, { status: 409 }); }
    }

    return new Response('Not found', { status: 404 });
  },
  async scheduled(_event: ScheduledController, env: WorldEnvironment): Promise<void> {
    const world = env.WORLD.getByName('arti-world');
    // Retries deliver saved outbox even after a previous queue failure.
    await world.flushOutbox();
    const backup = await world.backup(_event.scheduledTime);

    if (backup !== undefined) return;
    await world.alertOperations();

    if (env.PUBLIC_INDEX) await projectPublicKnowledge(env.PUBLIC_INDEX);
    const state = await world.inspect();

    if (state.paused) return;

    if (state.mode === 'simulation' && env.AUTO_SIMULATION_TICKS === 'true') {
      await world.command({ role: 'system' }, { type: 'world.tick' }, `scheduled-${_event.scheduledTime}`);
    }

    if (state.mode === 'live' && env.LIVE_ACTIVATED === 'true' && env.ENTITY_AGENT) {
      const activeGoal = state.goals.find(goal => goal.status === 'active' && (!state.visitorBuild?.sharedOnly || publicVisitorGoal(state, goal)));
      const unfinishedGoal = state.goals.some(goal => !['completed', 'cancelled'].includes(goal.status));
      const assigned = new Set(state.tasks.filter(task => task.goalId === activeGoal?.id && task.revision === activeGoal?.revision && ['queued', 'running'].includes(task.status) && task.dependencies.every(id => state.tasks.some(dependency => dependency.id === id && dependency.status === 'verified'))).map(task => task.entityId));
      const agents = env.ENTITY_AGENT;

      if (governanceLane(_event.scheduledTime, assigned.size > 0)) {
        const reviewers = ['moderator', 'researcher', 'steward'];
        const offset = Math.floor(_event.scheduledTime / 180000) % reviewers.length;

        for (let index = 0; index < 2; index += 1) {
          const entityId = reviewers[(offset + index) % reviewers.length];
          const context = governanceContext(state, entityId);
          const agent = await getAgentByName(agents, entityId);
          const recovery = await agent.recoveryStatus();

          if ((!context && !recovery.governancePending) || recovery.blocked || recovery.running && !recovery.leaseExpired || recovery.pending && !recovery.governancePending) continue;
          await recordLiveTurnOutcome(() => agent.runGovernance(), metric => world.noteOperation(metric));

          return;
        }
      }


      if (state.visitorBuild?.sharedOnly && !assigned.size) return;

      const candidates = liveCandidateWindow(state.entities, assigned, unfinishedGoal, _event.scheduledTime);

      for (const entity of candidates) {
        const agent = await getAgentByName(agents, entity.id);
        const recovery = await agent.recoveryStatus();

        if (!liveTurnDue(entity, recovery, assigned.has(entity.id), unfinishedGoal, _event.scheduledTime)) continue;

        if (recovery.running || recovery.pending) await world.noteOperation('entity.wake_recovery');
        // Stop after one independent slice; do not consume another resident's nested RPC budget.
        const action = scheduledAction(recovery, assigned.has(entity.id));
        await recordLiveTurnOutcome(() => action === 'conversation' ? agent.runConversation() : agent.runLive(), metric => world.noteOperation(metric));
        break;
      }
    }
  },
  async queue(batch: MessageBatch<ProjectionMessage>, env: WorldEnvironment): Promise<void> {
    if (batch.queue.endsWith('-dead')) { for (const _message of batch.messages) await env.WORLD.getByName('arti-world').noteOperation('projection.dead_letters'); batch.ackAll();

 return; }

    if (!env.PUBLIC_INDEX) { await env.WORLD.getByName('arti-world').noteOperation('projection.retry'); batch.retryAll();

 return; }

    await env.PUBLIC_INDEX.prepare('CREATE TABLE IF NOT EXISTS public_world (id INTEGER PRIMARY KEY, sequence INTEGER NOT NULL, value TEXT NOT NULL)').run();

    for (const message of batch.messages) {
      const parsed = sequenceSchema.safeParse(message.body);

      if (!parsed.success) { await env.WORLD.getByName('arti-world').noteOperation('projection.invalid'); message.ack(); continue; }

      const { sequence } = parsed.data;

      try {
        await env.PUBLIC_INDEX.prepare('INSERT INTO public_world(id,sequence,value) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence,value=excluded.value WHERE excluded.sequence>public_world.sequence').bind(sequence, JSON.stringify(message.body.projection)).run();
        await env.WORLD.getByName('arti-world').noteOperation('projection.applied_sequence', sequence);
        await env.WORLD.getByName('arti-world').noteOperation('projection.applied_at', Date.now());
        message.ack();
      } catch { await env.WORLD.getByName('arti-world').noteOperation('projection.retry'); message.retry(); }
    }
  },
};
