import { resetSharedPublicState } from './shared-reset';
import { dispatchDay, entityDailyCommitment, refreshDailyBudget } from './daily-budget';
import { z } from 'zod';
import { VisitorBuildAuthority } from './visitor-build';
import { visitorBuildStateSchema, type ReviewObservation } from '../../contracts/src/visitor-build';
import { createHash } from 'node:crypto';
import { localInferenceSchema, entityPresenceSchema, commandSchema, type EntityPresence, type Actor, type Command, type Deployment, type Goal, type PublicWorld, type Discussion, type Task, type WorldState } from '../../contracts/src/index';

export class WorldError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'WorldError'; }
}

const seedClock = '2026-10-12T00:00:00.000Z';

const population = [
  ['steward', 'Atlas', 'steward', '#c77dff', 'Coordinates shared work', 'deliberate'],
  ['moderator', 'Iris', 'moderator', '#ffb86b', 'Reviews evidence and community decisions', 'fair'],
  ['builder-1', 'Nova', 'builder', '#6ae6c3', 'Builds useful services', 'inventive'],
  ['builder-2', 'Flux', 'builder', '#69b7ff', 'Builds thoughtful interfaces', 'practical'],
  ['builder-3', 'Bolt', 'builder', '#f4d06f', 'Builds reliable application workflows', 'methodical'],
  ['builder-4', 'Rune', 'builder', '#b794f6', 'Integrates and tests shared releases', 'collaborative'],
  ['researcher', 'Sage', 'researcher', '#ff87b4', 'Researches and records provenance', 'curious'],
  ['archivist', 'Echo', 'archivist', '#dfd77b', 'Maintains public knowledge', 'precise'],
];

export function createInitialState(): WorldState {
  return {
    schemaVersion: 1, mode: 'simulation', paused: false, clock: seedClock,
    entities: population.map(([id = '', name = '', role = '', color = '', description = '', trait = '']) => ({ id, name, role, color, description, personality: [trait], interests: ['digital world'], status: 'idle', siteVersion: 0, lastActiveAt: null, dailyAllowanceUsd: 0, presence: { locationId: id, activity: 'idle', summary: 'At home', peers: [], updatedAt: seedClock } })),
    projects: [{ id: 'collective', name: 'Arti collective', description: 'One shared website built by an eight-agent team', repository: 'collective', siteVersion: 0 }],
    goals: [], tasks: [], discussions: [], relationships: [], events: [], evidence: [], deployments: [],
    appointments: ['steward', 'moderator'].map((entityId, index) => ({ id: `office-${entityId}`, entityId, role: index === 0 ? 'steward' : 'moderator', expiresAt: '2026-10-19T00:00:00.000Z' })),
    personalityHistory: [], confirmations: [], governance: [], receipts: [], reservations: [],
    budget: { dailyUsd: 0, spentUsd: 0, reservedUsd: 0, day: seedClock.slice(0, 10) }, processedCommands: {}, turn: 0,
  };
}

function requireCondition(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) throw new WorldError(code, message);
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function actorId(actor: Actor): string { return actor.role === 'entity' ? actor.entityId ?? '' : actor.role; }

export class WorldEngine {
  private state: WorldState;
  constructor(initial: WorldState = createInitialState(), private readonly localInference = false) {
    this.state = structuredClone(initial);

    if (!localInference) delete this.state.localInference;
    const foundation = createInitialState();
    this.state.projects ??= foundation.projects;

    for (const entity of foundation.entities) if (!this.state.entities.some(existing => existing.id === entity.id)) this.state.entities.push({ ...entity, lastActiveAt: null, status: this.state.paused ? 'paused' : 'idle' });

    this.rollBudgetDay();

    for (const entity of this.state.entities) entity.presence ??= { locationId: entity.id, activity: 'idle', summary: 'At home', peers: [], updatedAt: this.state.clock };
  }
  resetSharedWebsite(): WorldState {
    this.state = resetSharedPublicState(this.state);

    return this.getState();
  }
  /** Internal local-service capability, never enabled by commands or restored metadata. */
  configureLocalInference(dailyUsd: number): void {
    requireCondition(this.localInference && this.state.mode === 'simulation', 'forbidden', 'Local inference service required');
    requireCondition(Number.isFinite(dailyUsd) && dailyUsd > 0 && dailyUsd <= 1, 'invalid_amount', 'Local allowance must be positive and at most $1/day');
    this.state.clock = new Date().toISOString();
    this.rollBudgetDay();
    requireCondition(dailyUsd >= this.state.budget.spentUsd + this.state.budget.reservedUsd, 'budget_conflict', 'Local allowance is below committed usage');
    this.state.budget.dailyUsd = dailyUsd;

    for (const entity of this.state.entities) entity.dailyAllowanceUsd = dailyUsd;
    this.state.localInference = { model: '@cf/zai-org/glm-4.7-flash', status: 'ready' };
  }
  localStatus(status: 'ready' | 'working' | 'blocked', error?: string): void {
    requireCondition(this.localInference && !!this.state.localInference, 'forbidden', 'Local inference service required');
    this.state.clock = new Date().toISOString();
    this.state.localInference = { model: '@cf/zai-org/glm-4.7-flash', status, error };
  }
  /** Structural local checks unlock dependencies, never human acceptance criteria. */
  recordLocalTask(taskId: string, deployment: Deployment): void {
    requireCondition(this.localInference && !this.state.paused, 'forbidden', 'Active local inference required');
    const task = this.state.tasks.find(item => item.id === taskId && item.status === 'running');
    const goal = task ? this.state.goals.find(item => item.id === task.goalId && item.status === 'active' && item.revision === task.revision) : undefined;
    requireCondition(!!task && !!goal && deployment.taskId === taskId && deployment.goalId === goal.id && deployment.revision === goal.revision && deployment.entityId === task.entityId && deployment.projectId === task.projectId && deployment.environment === 'simulation' && deployment.authorship === 'agent', 'stale_task', 'Local result does not match active task');

    if (!task || !goal) return;
    this.recordDeployment(deployment);
    const id = this.id('local-check');
    this.state.evidence.push({ id, goalId: goal.id, revision: goal.revision, taskId, entityId: task.entityId, criterion: 'Local static HTML structure and immutable commit', sourceCommit: deployment.commit, environment: 'simulation', status: 'verified', assertions: ['Real GLM-authored file committed locally', 'Static document structure checked; scripts not executed', 'Local preview only; no cloud or semantic acceptance verification'], createdAt: this.state.clock, deploymentId: deployment.id });
    task.evidenceIds.push(id);
    task.status = 'verified';
    this.presence(task.entityId, 'idle', 'Local contribution checked');
    this.event({ role: 'entity', entityId: task.entityId }, 'local.code_checked', 'GLM contribution committed and locally checked', 'public');
    this.submitIfReady(goal);
  }
  /** Scripted demo governance is restricted to the ordinary simulation service. */
  advanceVisitorSimulation(): void {
    if (this.state.mode !== 'simulation' || this.localInference || this.state.paused) return;
    const suggestions = this.state.visitorBuild?.suggestions ?? [];
    const pending = suggestions.find(item => item.status === 'pending');
    const actor = (entityId: string): Actor => ({ role: 'entity', entityId });
    const key = `simulation-proposal-${this.state.turn}-${this.state.receipts.length}`;

    if (pending) {
      this.dispatch(actor('moderator'), { type: 'suggestion.review', suggestionId: pending.id, brief: pending.text, criteria: ['The checked simulation fixture is published'], reason: 'Scripted simulation review; not a live model assessment', rejected: false }, key);

      return;
    }

    const reviewed = suggestions.find(item => ['reviewing', 'eligible'].includes(item.status) && item.votes.length < 3);

    if (reviewed) {
      const entityId = ['moderator', 'researcher', 'steward'].find(id => !reviewed.votes.some(vote => vote.entityId === id));

      if (entityId) this.dispatch(actor(entityId), { type: 'suggestion.vote', suggestionId: reviewed.id, approved: true, usefulness: 3, fit: 3, feasibility: 3, reason: 'Scripted simulation vote; no live inference' }, key);

      return;
    }

    if (!this.state.goals.some(goal => !['completed', 'cancelled'].includes(goal.status)) && suggestions.some(item => item.status === 'eligible')) {
      this.dispatch(actor('steward'), { type: 'suggestion.select' }, key);

      return;
    }

    const goal = this.state.goals.find(item => item.suggestionId && item.status === 'awaiting_acceptance');
    const release = this.state.deployments.findLast(item => item.goalId === goal?.id && item.revision === goal?.revision && item.environment === 'simulation');

    if (!goal || !release || !this.state.tasks.filter(item => item.goalId === goal.id && item.revision === goal.revision).every(item => item.status === 'verified')) return;
    goal.status = 'active';
    const observationId = `simulation-observation-${release.id}`;
    this.recordReviewObservation({ id: observationId, goalId: goal.id, revision: goal.revision, deploymentId: release.id, commit: release.commit, reviewerId: 'moderator', createdAt: new Date().toISOString(), contentHash: digest('Explicit simulated fixture observation'), environment: 'simulation' });

    for (const [criterionIndex] of (goal.revisions.at(-1)?.criteria ?? []).entries()) this.dispatch(actor('moderator'), { type: 'suggestion.verify', goalId: goal.id, expectedRevision: goal.revision, criterionIndex, deploymentId: release.id, observationId, assertions: ['Simulation fixture only; not semantic or cloud verification'] }, `${key}-verify-${criterionIndex}`);
    this.dispatch(actor('steward'), { type: 'suggestion.complete', goalId: goal.id, expectedRevision: goal.revision }, `${key}-complete`);
  }
  getPublicBuild() { return new VisitorBuildAuthority(this.state).publicBuild(); }
  upsertVisitor(id: string, name: string) {
    this.publicText(name);

    return new VisitorBuildAuthority(this.state).visitor(id, name);
  }
  submitSuggestion(visitorId: string, text: string, key: string, ipHash: string) {
    this.publicText(text);

    const suggestion = new VisitorBuildAuthority(this.state).submit(visitorId, text, key, ipHash);
    this.state.clock = new Date(Math.max(Date.parse(this.state.clock), Date.now())).toISOString();

    return suggestion;
  }
  noteVisitorReviewBlocker(entityId: string, goalId: string, revision: number): void { new VisitorBuildAuthority(this.state).blockReview(entityId, goalId, revision); }
  recordReviewObservation(receipt: ReviewObservation): void { new VisitorBuildAuthority(this.state).observe(receipt); }
  getState(): WorldState { return structuredClone(this.state); }
  getPublicState(): PublicWorld {
    const state = this.state;

    return structuredClone({
      localInference: state.localInference, projects: state.projects, mode: state.mode, paused: state.paused, clock: state.clock, entities: state.entities.map(entity => ({ ...entity, presence: entity.presence ?? { locationId: entity.id, activity: 'idle', summary: 'At home', peers: [], updatedAt: state.clock } })),
      discussions: state.discussions.filter(item => item.visibility === 'public'),
      relationships: state.relationships, events: state.events.filter(item => item.visibility === 'public'), appointments: state.appointments,
      personalityHistory: state.personalityHistory.filter(item => item.eventIds.every(id => state.events.some(event => event.id === id && event.visibility === 'public'))),
      governance: state.governance,
      deployments: state.deployments.map(({ goalId: _goalId, revision: _revision, taskId: _taskId, ...deployment }) => ({ ...deployment, authorship: deployment.projectId ? _taskId ? 'agent' as const : 'platform' as const : deployment.authorship })),
      stats: { entities: state.entities.length, discussions: state.discussions.filter(item => item.visibility === 'public').length, deployments: state.deployments.length, completedGoals: state.goals.filter(goal => goal.status === 'completed').length },
    });
  }
  dispatch(actor: Actor, input: Command, key: string): WorldState {
    const command = commandSchema.parse(input);
    requireCondition(key.length >= 8 && key.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(key), 'invalid_key', 'Use a valid idempotency key');
    requireCondition(['operator', 'system', 'entity'].includes(actor.role), 'unauthorized', 'Unknown actor');

    if (actor.role === 'entity') {
      requireCondition(this.state.entities.some(entity => entity.id === actor.entityId), 'unauthorized', 'Unknown entity');
      requireCondition(!this.state.paused, 'paused', 'World is paused');
    }

    const fingerprint = digest(JSON.stringify({ actor: actorId(actor), role: actor.role, command }));
    const prior = this.state.processedCommands[key];

    if (prior) { requireCondition(prior === fingerprint, 'idempotency_conflict', 'Key already used by another command or actor');

 return this.getState(); }

    const previous = this.state;
    this.state = structuredClone(previous);

    try {
      this.apply(actor, command);
      this.reflectPresence(actor, command);
      this.state.processedCommands[key] = fingerprint;
      this.state.receipts.push({ id: this.id('receipt'), actorId: actorId(actor), tool: command.type, status: 'succeeded', createdAt: this.state.clock, mode: this.state.mode });

      return this.getState();
    } catch (error) { this.state = previous; throw error; }
  }
  private presence(entityId: string, activity: EntityPresence['activity'], summary: string, locationId = entityId, peers: string[] = []): void {
    const entity = this.state.entities.find(item => item.id === entityId);

    if (!entity) return;
    entity.presence = { activity, summary, locationId, peers: peers.filter(id => id !== entityId && this.state.entities.some(item => item.id === id)), updatedAt: this.state.clock };
  }
  private taskPresence(task: Task): void {
    const entity = this.state.entities.find(item => item.id === task.entityId);
    const role = entity?.role;
    const activity = role === 'researcher' ? 'researching' : role === 'moderator' ? 'reviewing' : role === 'archivist' ? 'publishing' : 'working';
    this.presence(task.entityId, activity, activity === 'researching' ? 'Checking sources and provenance' : activity === 'reviewing' ? 'Reviewing checked outcomes' : activity === 'publishing' ? 'Preparing public knowledge' : 'Working on assigned work');
  }
  private reflectPresence(actor: Actor, command: Command): void {
    if (this.state.paused || command.type === 'world.tick') return;

    if (['task.claim', 'task.submit', 'task.fail', 'task.review'].includes(command.type) && 'taskId' in command) {
      const task = this.state.tasks.find(item => item.id === command.taskId);

      if (task?.status === 'running') this.taskPresence(task);
      else if (task) this.presence(task.entityId, task.status === 'submitted' ? 'reviewing' : 'idle', task.status === 'submitted' ? 'Awaiting independent review' : 'At home');
    }

    if (command.type === 'social.post' && actor.entityId) {
      const target = this.state.discussions.find(item => item.id === command.replyTo && item.visibility === 'public')?.entityId;
      this.presence(actor.entityId, 'discussing', 'Taking part in a public discussion', 'square', target ? [target] : []);

      if (target && target !== actor.entityId) this.presence(target, 'discussing', 'Received a public reply', 'square', [actor.entityId]);
    }

    if (command.type === 'entity.personality' && actor.entityId) this.presence(actor.entityId, 'reviewing', 'Reflecting on public experiences');

    if (command.type === 'goal.create' || command.type === 'goal.start' || command.type === 'goal.control' || command.type === 'goal.revise') {
      for (const entity of this.state.entities) if (!this.state.tasks.some(task => task.entityId === entity.id && task.status === 'running' && this.state.goals.some(goal => goal.id === task.goalId && goal.revision === task.revision && goal.status === 'active'))) this.presence(entity.id, 'idle', 'At home');
    }
  }
  private id(prefix: string): string { return `${prefix}-${this.state.events.length}-${this.state.receipts.length}-${this.state.turn}`; }
  private event(actor: Actor, type: string, summary: string, visibility: 'public' | 'private' = 'private'): void {
    this.state.events.push({ id: this.id('event'), sequence: this.state.events.length + 1, type, actorId: actorId(actor), summary, createdAt: this.state.clock, visibility });
  }
  private operator(actor: Actor): void { requireCondition(actor.role === 'operator', 'forbidden', 'Operator action required'); }
  private entity(actor: Actor): string { requireCondition(actor.role === 'entity' && Boolean(actor.entityId), 'forbidden', 'Entity action required');

 return actor.entityId ?? ''; }
  private goal(id: string, revision?: number): Goal {
    const goal = this.state.goals.find(item => item.id === id);
    requireCondition(Boolean(goal), 'not_found', 'Goal not found');

    if (!goal) throw new WorldError('not_found', 'Goal not found');

    if (revision !== undefined) requireCondition(goal.revision === revision, 'stale_revision', 'Goal revision has changed');

    return goal;
  }
  private tasks(goal: Goal): void {
    const specs: [string, string, string[]][] = [ ['researcher', 'Research and provenance', []], ['builder-1', 'Build service', ['researcher']], ['builder-2', 'Build public interface', ['researcher']], ['builder-3', 'Build application workflow', ['researcher']], ['builder-4', 'Integrate shared application', ['builder-1', 'builder-2', 'builder-3']], ['moderator', 'Verify outcomes', ['builder-1', 'builder-2', 'builder-3', 'builder-4']], ['archivist', 'Publish verified guide', ['moderator']], ['steward', 'Assemble completion evidence', ['archivist']] ];

    for (const [entityId, title, dependencies] of specs) this.state.tasks.push({ id: `${goal.id}-r${goal.revision}-${entityId}`, projectId: goal.projectId, goalId: goal.id, revision: goal.revision, entityId, title, status: 'queued', dependencies: dependencies.map(id => `${goal.id}-r${goal.revision}-${id}`), attempts: 0, evidenceIds: [] });
  }
  validatePublicText(text: string): void { this.publicText(text); }
  private publicText(text: string): void {
    const secrets = this.state.goals.flatMap(goal => [...goal.revisions.flatMap(revision => {
      const suggestion = this.state.visitorBuild?.suggestions.find(item => item.id === goal.suggestionId);
      const publicRevision = revision.revision === 1 && revision.publicBrief?.approvalId === `visitor-approval-${suggestion?.id}` && revision.objective === suggestion?.review?.brief;

      return publicRevision ? [...revision.constraints] : [revision.objective, ...revision.criteria, ...revision.constraints];
    }), ...goal.feedback]);

    for (const confirmation of this.state.confirmations) if (confirmation.answer) secrets.push(confirmation.answer);
    requireCondition(!secrets.some(secret => secret.length >= 8 && text.toLowerCase().includes(secret.toLowerCase())), 'private_content', 'Public content contains private goal material');
  }
  private apply(actor: Actor, command: Command): void {
    if (command.type.startsWith('suggestion.')) {
      if (command.type === 'suggestion.review') this.publicText([command.brief, command.reason, ...command.criteria].join('\n'));

      if (command.type === 'suggestion.vote') this.publicText(command.reason);
      const goal = new VisitorBuildAuthority(this.state).apply(actor, command);

      if (goal) this.tasks(goal);

      if ('goalId' in command || 'taskId' in command) {
        const goalId = 'goalId' in command ? command.goalId : this.state.tasks.find(task => task.id === command.taskId)?.goalId;
        const current = this.state.goals.find(item => item.id === goalId);

        if (current?.status === 'active') this.submitIfReady(current);
      }

      this.event(actor, command.type, command.type === 'suggestion.select' ? 'Selected the next visitor suggestion' : command.type === 'suggestion.complete' ? 'Independent review completed; the next suggestion can begin' : 'Agent decision recorded', 'public');

      return;
    }

    switch (command.type) {
      case 'goal.create': {
        this.operator(actor);
        requireCondition(!this.state.goals.some(goal => !['completed', 'cancelled'].includes(goal.status)), 'active_goal', 'Finish or cancel the existing goal first');
        const goal: Goal = { projectId: this.state.projects?.find(project => project.id === 'collective')?.id, id: this.id('goal'), status: 'draft', revision: 1, revisions: [{ revision: 1, objective: command.objective, criteria: command.criteria, constraints: command.constraints, createdAt: this.state.clock }], createdAt: this.state.clock, completedAt: null, feedback: [] };
        this.state.goals.push(goal); this.event(actor, command.type, 'Goal drafted');

 return;
      }

      case 'goal.public_brief': {
        this.operator(actor);
        const goal = this.goal(command.goalId, command.expectedRevision);
        requireCondition(['draft', 'active', 'paused'].includes(goal.status), 'invalid_transition', 'Goal cannot approve public authoring');
        const revision = goal.revisions.find(item => item.revision === goal.revision);
        requireCondition(Boolean(revision) && !revision?.publicBrief, 'already_approved', 'Revise the goal before changing an approved public brief');
        this.publicText(command.text);

        if (!revision) throw new WorldError('not_found', 'Goal revision not found');
        revision.publicBrief = { text: command.text, approvedAt: this.state.clock, approvalId: this.id('public-brief') };
        this.event(actor, command.type, 'Public authoring brief approved');

        return;
      }

      case 'goal.start': {
        this.operator(actor); const goal = this.goal(command.goalId);
        requireCondition(goal.status === 'draft', 'invalid_transition', 'Only a draft can start'); goal.status = 'active'; this.tasks(goal); this.event(actor, command.type, 'Shared goal started');

 return;
      }

      case 'goal.revise': {
        this.operator(actor); const goal = this.goal(command.goalId, command.expectedRevision);
        requireCondition(!['completed', 'cancelled'].includes(goal.status), 'invalid_transition', 'Closed goals cannot be revised');

        for (const task of this.state.tasks) if (task.goalId === goal.id) task.status = 'superseded';

        for (const evidence of this.state.evidence) if (evidence.goalId === goal.id) evidence.status = 'stale';

        for (const confirmation of this.state.confirmations) if (confirmation.goalId === goal.id && confirmation.status === 'pending') confirmation.status = 'superseded';
        const wasDraft = goal.status === 'draft'; const wasPaused = goal.status === 'paused'; goal.revision += 1; goal.revisions.push({ revision: goal.revision, objective: command.objective, criteria: command.criteria, constraints: command.constraints, createdAt: this.state.clock });

        if (!wasDraft) { goal.status = wasPaused ? 'paused' : 'active'; this.tasks(goal); }

 this.event(actor, command.type, 'Direction revised; prior evidence superseded');

 return;
      }

      case 'goal.control': {
        this.operator(actor); const goal = this.goal(command.goalId, command.expectedRevision);
        requireCondition(!['completed', 'cancelled', 'draft'].includes(goal.status), 'invalid_transition', 'Goal is not running');

        if (command.action === 'pause') { requireCondition(goal.status === 'active' || goal.status === 'blocked', 'invalid_transition', 'Goal cannot pause'); goal.status = 'paused'; }

        if (command.action === 'resume') {
          requireCondition(goal.status === 'paused' || goal.status === 'blocked', 'invalid_transition', 'Goal cannot resume'); goal.status = 'active';

          for (const task of this.state.tasks) if (task.goalId === goal.id && task.revision === goal.revision && task.status === 'blocked' && !this.state.confirmations.some(item => item.taskId === task.id && item.status === 'pending')) { task.status = 'queued'; task.attempts = 0; }
        }

        if (command.action === 'cancel') { goal.status = 'cancelled';

          for (const confirmation of this.state.confirmations) if (confirmation.goalId === goal.id && confirmation.status === 'pending') confirmation.status = 'superseded';

 for (const task of this.state.tasks) if (task.goalId === goal.id && task.status !== 'verified') task.status = 'superseded'; }

        if (command.action === 'accept') {
          requireCondition(goal.status === 'awaiting_acceptance', 'invalid_transition', 'Completion has not been submitted');
          const current = goal.revisions.at(-1);
          requireCondition(Boolean(current?.criteria.every(criterion => this.state.evidence.some(run => run.goalId === goal.id && run.revision === goal.revision && run.criterion === criterion && run.status === 'verified' && (this.state.mode === 'simulation' ? run.environment === 'simulation' : run.environment !== 'simulation')))), 'missing_evidence', 'Every criterion needs verified evidence');
          goal.status = 'completed'; goal.completedAt = this.state.clock;
        }

        if (command.action === 'request_changes') {
          requireCondition(goal.status === 'awaiting_acceptance' && command.feedback.trim().length > 0, 'invalid_transition', 'Feedback required for submitted completion');
          goal.status = 'active'; goal.feedback.push(command.feedback);

          for (const task of this.state.tasks) if (task.goalId === goal.id && task.revision === goal.revision) { task.status = 'queued'; task.evidenceIds = []; }

          for (const run of this.state.evidence) if (run.goalId === goal.id) run.status = 'stale';
        }

        this.event(actor, command.type, `Goal ${command.action}`);

 return;
      }

      case 'task.claim': case 'task.submit': case 'task.fail': case 'task.review': {
        const task = this.state.tasks.find(item => item.id === command.taskId);
        requireCondition(Boolean(task), 'not_found', 'Task not found');

        if (!task) return;
        const goal = this.goal(task.goalId, command.expectedRevision);
        requireCondition(goal.status === 'active' && !this.state.paused && task.revision === goal.revision, 'stale_task', 'Task no longer active');

        if (command.type === 'task.claim') {
          requireCondition(this.entity(actor) === task.entityId, 'forbidden', 'Only the assigned entity can claim');
          requireCondition(task.status === 'queued' && task.dependencies.every(id => this.state.tasks.some(item => item.id === id && item.status === 'verified')), 'not_ready', 'Task dependencies not verified');
          requireCondition(!this.state.tasks.some(item => item.entityId === task.entityId && item.status === 'running'), 'busy', 'Entity already has running work');
          task.status = 'running'; task.attempts += 1;
        } else if (command.type === 'task.submit') {
          requireCondition(this.entity(actor) === task.entityId && task.status === 'running', 'forbidden', 'Only assigned running work can be submitted');
          task.status = 'submitted';
          this.state.discussions.push({ id: this.id('private-submission'), entityId: task.entityId, body: command.summary, createdAt: this.state.clock, visibility: 'private', goalId: goal.id, taskId: task.id, revision: goal.revision });
        } else if (command.type === 'task.fail') {
          requireCondition(this.entity(actor) === task.entityId && task.status === 'running', 'forbidden', 'Only assigned running work can fail');
          task.status = task.attempts >= 3 ? 'blocked' : 'queued';
          goal.feedback.push(command.reason);

          if (task.status === 'blocked') goal.status = 'blocked';
        } else {
          this.operator(actor);
          requireCondition(task.status === 'submitted', 'not_submitted', 'Task needs a completion submission');
          task.status = command.approved ? 'verified' : task.attempts >= 3 ? 'blocked' : 'queued';
          goal.feedback.push(command.feedback);

          if (task.status === 'blocked') goal.status = 'blocked';
        }

        this.event(actor, command.type, 'Task state updated');
        this.submitIfReady(goal);

        return;
      }

      case 'goal.verify': {
        this.operator(actor);
        const goal = this.goal(command.goalId, command.expectedRevision);
        requireCondition((this.state.mode === 'live' || this.localInference) && goal.status === 'active', 'invalid_transition', 'Live criterion verification requires an active goal');
        const criterion = goal.revisions.at(-1)?.criteria[command.criterionIndex];
        requireCondition(Boolean(criterion), 'not_found', 'Criterion not found');
        const deployment = this.state.deployments.find(item => item.id === command.deploymentId && item.goalId === goal.id && item.revision === goal.revision && (this.localInference ? item.environment === 'simulation' && item.authorship === 'agent' : item.environment !== 'simulation') && item.status === 'published');
        requireCondition(Boolean(deployment), 'missing_evidence', 'A current checked deployment is required');

        if (!criterion || !deployment) return;
        const task = this.state.tasks.find(item => item.goalId === goal.id && item.revision === goal.revision && item.entityId === 'steward');
        requireCondition(Boolean(task), 'not_found', 'Completion task not found');

        if (!task) return;
        const id = this.id('operator-evidence');
        this.state.evidence.push({ id, goalId: goal.id, revision: goal.revision, taskId: task.id, entityId: 'steward', criterion, sourceCommit: deployment.commit, environment: deployment.environment, status: 'verified', assertions: [this.localInference ? 'Operator independently reviewed local GLM preview; no cloud verification' : 'Operator independently reviewed saved outcome', ...command.assertions], createdAt: this.state.clock, deploymentId: deployment.id });
        task.evidenceIds.push(id);
        this.event(actor, command.type, 'Criterion independently reviewed');
        this.submitIfReady(goal);

        return;
      }

      case 'world.pause': this.operator(actor); this.state.paused = command.paused; this.event(actor, command.type, command.paused ? 'World paused' : 'World resumed');

 return;
      case 'world.tick': requireCondition(actor.role === 'operator' || actor.role === 'system', 'forbidden', 'Only scheduler or operator may advance'); this.tick();

 return;
      case 'social.post': {
        const entityId = this.entity(actor);
        this.publicText(command.body);
        requireCondition(!this.state.paused, 'paused', 'World is paused');
        requireCondition(!this.state.governance.some(decision => decision.kind === 'moderation' && decision.targetId === entityId && Boolean(decision.expiresAt && decision.expiresAt > this.state.clock)), 'moderated', 'Messaging temporarily restricted');

        if (command.replyTo) requireCondition(this.state.discussions.some(item => item.id === command.replyTo && item.visibility === 'public'), 'not_found', 'Public discussion not found');
        const discussion: Discussion = { id: this.id('discussion'), entityId, body: command.body, createdAt: this.state.clock, visibility: 'public', origin: this.state.mode === 'simulation' && !this.localInference ? 'simulation' : 'agent' };

        if (command.replyTo) discussion.replyTo = command.replyTo;
        this.state.discussions.push(discussion);
        this.event(actor, command.type, 'Published a public discussion', 'public');

 return;
      }

      case 'entity.profile': {
        const entityId = this.entity(actor); this.publicText(command.name); this.publicText(command.description);
        const entity = this.state.entities.find(item => item.id === entityId);

        if (entity) { entity.name = command.name; entity.description = command.description; }

        this.event(actor, command.type, 'Updated public name and description', 'public');

 return;
      }

      case 'relationship.record': {
        const entityId = this.entity(actor); this.publicText(command.label);
        requireCondition(command.targetId !== entityId && this.state.entities.some(entity => entity.id === command.targetId), 'not_found', 'Choose another existing entity');
        requireCondition(command.eventIds.every(id => this.state.events.some(event => event.id === id && event.visibility === 'public')), 'invalid_provenance', 'Relationship claims require public source events');
        this.state.relationships.push({ id: this.id('relationship'), entityId, targetId: command.targetId, label: command.label, kind: 'agent_claim', eventIds: command.eventIds, createdAt: this.state.clock });
        this.event(actor, command.type, 'Published an agent relationship claim', 'public');

 return;
      }

      case 'entity.personality': {
        const entityId = this.entity(actor);
        this.publicText(command.trait);
        this.publicText(command.rationale);
        requireCondition(command.eventIds.every(id => this.state.events.some(event => event.id === id && event.visibility === 'public')), 'invalid_provenance', 'Personality sources must be public observed events');
        this.state.personalityHistory.push({ id: this.id('personality'), entityId, trait: command.trait, rationale: command.rationale, eventIds: command.eventIds, createdAt: this.state.clock });
        this.event(actor, command.type, 'Proposed a personality update', 'public');

 return;
      }

      case 'governance.appoint': {
        this.operator(actor);
        requireCondition(this.state.entities.some(entity => entity.id === command.entityId), 'not_found', 'Entity not found');

        for (const office of this.state.appointments) if (office.role === command.role && office.expiresAt > this.state.clock) office.expiresAt = this.state.clock;
        this.state.appointments.push({ id: this.id('office'), entityId: command.entityId, role: command.role, expiresAt: new Date(Date.parse(this.state.clock) + 7 * 86400000).toISOString() });
        this.event(actor, command.type, 'Operator appointed a seven-day office', 'public');

 return;
      }

      case 'governance.propose': case 'governance.appeal': {
        const entityId = this.entity(actor);
        this.publicText(command.text); this.state.governance.push({ id: this.id('decision'), entityId, kind: command.type === 'governance.propose' ? 'proposal' : 'appeal', text: command.text, createdAt: this.state.clock });
        this.event(actor, command.type, 'Published a governance contribution', 'public');

 return;
      }

      case 'governance.moderate': {
        const entityId = this.entity(actor);
        this.publicText(command.reason);
        requireCondition(this.state.appointments.some(office => office.entityId === entityId && office.role === 'moderator' && office.expiresAt > this.state.clock), 'forbidden', 'An active moderator appointment is required');
        requireCondition(this.state.entities.some(entity => entity.id === command.targetId), 'not_found', 'Entity not found');
        this.state.governance.push({ id: this.id('decision'), entityId, kind: 'moderation', text: command.reason, targetId: command.targetId, createdAt: this.state.clock, expiresAt: new Date(Date.parse(this.state.clock) + command.minutes * 60000).toISOString() });
        this.event(actor, command.type, 'Applied bounded messaging restriction', 'public');

 return;
      }

      case 'confirmation.request': {
        const entityId = this.entity(actor);
        const task = this.state.tasks.find(item => item.id === command.taskId && item.entityId === entityId);
        requireCondition(Boolean(task), 'forbidden', 'Confirmation requires an assigned task');

        if (!task) return;
        const goal = this.goal(task.goalId, command.expectedRevision);
        requireCondition(goal.status === 'active' && task.revision === goal.revision && task.status === 'running', 'stale_task', 'Only active assigned work can request confirmation');
        requireCondition(!this.state.confirmations.some(item => item.taskId === task.id && item.revision === goal.revision && item.status === 'pending'), 'confirmation_pending', 'Task already awaits confirmation');
        this.state.confirmations.push({ id: this.id('confirmation'), goalId: goal.id, revision: goal.revision, entityId, taskId: task.id, question: command.question, status: 'pending' });
        task.status = 'blocked'; this.event(actor, command.type, 'Awaiting explicit human direction');

 return;
      }

      case 'confirmation.respond': {
        this.operator(actor); const confirmation = this.state.confirmations.find(item => item.id === command.confirmationId);
        requireCondition(Boolean(confirmation), 'not_found', 'Confirmation not found');

        if (!confirmation) throw new WorldError('not_found', 'Confirmation not found');
        const goal = this.goal(confirmation.goalId, command.expectedRevision);
        requireCondition(!['completed', 'cancelled', 'draft'].includes(goal.status), 'invalid_transition', 'Goal no longer accepts confirmation');
        requireCondition(confirmation.status === 'pending' && confirmation.revision === command.expectedRevision, 'stale_confirmation', 'Confirmation is no longer pending');
        confirmation.status = 'answered'; confirmation.answer = command.answer;
        const task = this.state.tasks.find(item => item.id === confirmation.taskId && item.revision === goal.revision && item.status === 'blocked');

        if (task) task.status = 'queued'; this.event(actor, command.type, 'Human direction recorded');

 return;
      }

      case 'budget.reconcile': this.operator(actor); this.settleBudget(command.reservationId, command.actualUsd); this.event(actor, command.type, 'Operator reconciled measured provider usage');

 return;
      case 'budget.entity.configure': {
        this.operator(actor); this.rollBudgetDay();
        const entity = this.state.entities.find(item => item.id === command.entityId);
        requireCondition(Boolean(entity), 'not_found', 'Entity not found');
        requireCondition(command.dailyUsd >= this.entityCommitted(command.entityId), 'budget_conflict', 'Entity cap cannot fall below committed usage');

        if (entity) entity.dailyAllowanceUsd = command.dailyUsd;
        this.event(actor, command.type, 'Entity allowance cap updated');

 return;
      }

      case 'budget.configure': this.operator(actor); this.rollBudgetDay(); requireCondition(command.dailyUsd >= this.state.budget.spentUsd + this.state.budget.reservedUsd, 'budget_conflict', 'Allowance cannot fall below committed usage'); this.state.budget.dailyUsd = command.dailyUsd; this.event(actor, command.type, 'Allowance updated; live activation remains separate');

 return;
    }
  }
  private submitIfReady(goal: Goal): void {
    const tasks = this.state.tasks.filter(task => task.goalId === goal.id && task.revision === goal.revision);
    const criteria = goal.revisions.at(-1)?.criteria ?? [];

    if (tasks.length && tasks.every(task => task.status === 'verified') && criteria.every(criterion => this.state.evidence.some(run => run.goalId === goal.id && run.revision === goal.revision && run.criterion === criterion && run.status === 'verified' && (!goal.suggestionId || run.reviewKind === 'agent' && this.state.deployments.some(deployment => deployment.id === run.deploymentId && deployment.status === 'published' && deployment.commit === run.sourceCommit && deployment.version === this.state.projects?.find(project => project.id === goal.projectId)?.siteVersion)) && (this.state.mode === 'simulation' ? run.environment === 'simulation' : run.environment !== 'simulation')))) goal.status = 'awaiting_acceptance';
  }
  private tick(): void {
    if (this.state.paused) return;
    requireCondition(this.state.mode === 'simulation' && !this.localInference, 'live_disabled', 'Simulation ticks cannot run alongside real agents');
    this.state.turn += 1; this.state.clock = new Date(Date.parse(this.state.clock) + 60000).toISOString();

    for (const update of this.state.personalityHistory) {
      const entity = this.state.entities.find(item => item.id === update.entityId);

      if (entity && update.createdAt < this.state.clock && !entity.personality.includes(update.trait)) entity.personality.push(update.trait);
    }

    const goal = this.state.goals.find(item => item.status === 'active');

    if (!goal) {
      if (this.state.goals.some(item => !['completed', 'cancelled'].includes(item.status))) return;
      this.explore();

      return;
    }

    const tasks = this.state.tasks.filter(task => task.goalId === goal.id && task.revision === goal.revision);

    for (const task of tasks) if (task.status === 'running') this.verify(task, goal);
    const running = tasks.filter(task => task.status === 'running').length;
    const ready = tasks.filter(task => task.status === 'queued' && task.dependencies.every(id => tasks.some(item => item.id === id && item.status === 'verified')));

    for (const task of ready.slice(0, 2 - running)) {
      task.status = 'running'; task.attempts += 1;
      const entity = this.state.entities.find(item => item.id === task.entityId);

      if (entity) { entity.status = 'working'; entity.lastActiveAt = this.state.clock; }

      this.taskPresence(task);

      this.event({ role: 'entity', entityId: task.entityId }, 'task.started', `${task.title} started (simulation)`);
    }

    if (tasks.length > 0 && tasks.every(task => task.status === 'verified')) { goal.status = 'awaiting_acceptance'; this.event({ role: 'system' }, 'goal.submitted', 'Simulated completion evidence ready for human acceptance'); }
  }
  private verify(task: Task, goal: Goal): void {
    task.status = 'verified'; const entity = this.state.entities.find(item => item.id === task.entityId);

    if (entity) entity.status = 'idle';
    this.presence(task.entityId, 'idle', 'Checked work is ready for review');
    const criteria = task.entityId === 'steward' ? goal.revisions.at(-1)?.criteria ?? [] : [task.title];

    for (const criterion of criteria) {
      const id = `${task.id}-evidence-${task.evidenceIds.length}`;
      this.state.evidence.push({ id, goalId: goal.id, revision: goal.revision, taskId: task.id, entityId: task.entityId, criterion, sourceCommit: digest(`${task.id}:${criterion}`).slice(0, 40), environment: 'simulation', status: 'verified', assertions: ['Deterministic simulation workflow completed', 'Simulation fixture only: not cloud or live-model verification'], createdAt: this.state.clock });
      task.evidenceIds.push(id);
    }

    this.event({ role: 'entity', entityId: task.entityId }, 'task.verified', `${task.title} verified against simulation fixtures`);

    const safeMessages = new Map([
      ['researcher', 'I have prepared fixture sources and provenance for a simulated knowledge garden.'],
      ['builder-1', 'The simulated service now has a versioned source revision ready for inspection.'],
      ['builder-2', 'I have prepared a public interface using safe simulation content.'],
      ['builder-3', 'The shared workflow has a checked simulated contribution.'],
      ['builder-4', 'The simulated shared integration is ready for review.'],
      ['moderator', 'Simulation checks are recorded. They do not establish cloud or real-model correctness.'],
      ['archivist', 'The public walkthrough is tied to a simulated verification record.'],
      ['steward', 'Our simulation collaboration has produced evidence for operator review.'],
    ]);

    const body = safeMessages.get(task.entityId);

    if (body) {
      this.state.discussions.push({ id: this.id('discussion'), entityId: task.entityId, body, createdAt: this.state.clock, visibility: 'public', origin: 'simulation' });
      this.event({ role: 'entity', entityId: task.entityId }, 'social.post', 'Shared a safe simulation progress note', 'public');
      const source = this.state.events.at(-1);

      if (source && !this.state.personalityHistory.some(item => item.entityId === task.entityId && item.trait === 'evidence-minded')) {
        this.state.personalityHistory.push({ id: `${task.id}-reflection`, entityId: task.entityId, trait: 'evidence-minded', rationale: 'A public simulation exchange reinforced traceable verification', eventIds: [source.id], createdAt: this.state.clock });
      }
    }
  }
  private explore(): void {
    for (const entity of this.state.entities) this.presence(entity.id, 'idle', 'At home');
    const count = this.state.entities.length;

    if (count < 2) return;
    const index = (this.state.turn - 1) % count;
    const visitor = this.state.entities[index];
    const host = this.state.entities[(index + 1 + Math.floor(this.state.turn / count) % (count - 1)) % count];

    if (!visitor || !host) return;
    visitor.lastActiveAt = this.state.clock;

    if (this.state.turn % 3 !== 0) {
      this.presence(visitor.id, 'exploring', 'Visiting another entity’s home', host.id, [host.id]);
      this.event({ role: 'entity', entityId: visitor.id }, 'entity.visited', `Visited resident ${host.id} (simulation)`, 'public');

      return;
    }

    this.presence(visitor.id, 'discussing', 'Exchanging ideas in the world square', 'square', [host.id]);
    this.presence(host.id, 'discussing', 'Exchanging ideas in the world square', 'square', [visitor.id]);
    const topic = host.interests[this.state.turn % Math.max(1, host.interests.length)] ?? 'public knowledge';
    const trait = visitor.personality[this.state.turn % Math.max(1, visitor.personality.length)] ?? 'thoughtful';
    const latest = this.state.deployments.findLast(item => item.entityId === host.id);
    const label = ' [Simulation dialogue generated from public world records.]';

    const prompts = [
      `${host.name}, how could your ${host.role} perspective improve ${topic}? I bring a ${trait} approach from my home at version ${visitor.siteVersion}.`,
      `${host.name}, can we combine our ${visitor.role} and ${host.role} perspectives on ${topic}? Your public home is at version ${host.siteVersion}.`,
      `${host.name}, ${latest ? `your ${latest.environment} release at version ${latest.version}` : `your public interests in ${topic}`} caught my attention. What small improvement would you check next?`,
    ];

    const approaches = new Map([
      ['builder', 'make one small service change, then check its saved result'],
      ['researcher', 'trace claims back to primary sources and record provenance'],
      ['moderator', 'make the review criteria clear and check the outcome fairly'],
      ['archivist', 'connect the explanation to a verified guide that others can follow'],
      ['steward', 'agree on a bounded next step and keep responsibilities clear'],
    ]);

    const ask = prompts[Math.floor(this.state.turn / 3) % prompts.length] + label;
    const answer = `${visitor.name}, my ${host.personality[0] ?? 'thoughtful'} approach as a ${host.role} is to ${approaches.get(host.role) ?? 'document and check one useful change'}. We can apply that to ${topic} and compare the public result.` + label;

    const publicBody = (body: string) => {
      try { this.publicText(body);

 return body; } catch { return 'Residents are comparing their already-public ideas for a checked improvement.' + label; }
    };

    const discussion: Discussion = { id: this.id('discussion'), entityId: visitor.id, body: publicBody(ask), createdAt: this.state.clock, visibility: 'public', origin: 'simulation' };
    this.state.discussions.push(discussion);
    this.event({ role: 'entity', entityId: visitor.id }, 'social.exchange', `Asked resident ${host.id} about public ideas (simulation)`, 'public');
    const askEvent = this.state.events.at(-1);
    this.state.discussions.push({ id: this.id('discussion'), entityId: host.id, body: publicBody(answer), replyTo: discussion.id, createdAt: this.state.clock, visibility: 'public', origin: 'simulation' });
    this.event({ role: 'entity', entityId: host.id }, 'social.reply', `Replied to resident ${visitor.id} about public ideas (simulation)`, 'public');
    const answerEvent = this.state.events.at(-1);

    if (askEvent && answerEvent) {
      for (const [resident, peer] of [[visitor, host], [host, visitor]]) {
        if (!resident || !peer) continue;

        if (!this.state.relationships.some(item => item.entityId === resident.id && item.targetId === peer.id && item.label === 'Simulation idea partner')) this.state.relationships.push({ id: this.id(`relationship-${resident.id}`), entityId: resident.id, targetId: peer.id, label: 'Simulation idea partner', kind: 'agent_claim', eventIds: [askEvent.id, answerEvent.id], createdAt: this.state.clock });
        const exchanges = this.state.events.filter(event => event.actorId === resident.id && ['social.exchange', 'social.reply'].includes(event.type) && event.visibility === 'public');

        if (exchanges.length >= 2 && !this.state.personalityHistory.some(item => item.entityId === resident.id && item.trait === 'collaborative')) this.state.personalityHistory.push({ id: this.id(`personality-${resident.id}`), entityId: resident.id, trait: 'collaborative', rationale: 'Repeated public simulation exchanges encouraged checking ideas with peers', eventIds: exchanges.slice(-2).map(event => event.id), createdAt: this.state.clock });
      }
    }

  }
  private rollBudgetDay(): void { refreshDailyBudget(this.state); }
  private entityCommitted(entityId: string): number { return entityDailyCommitment(this.state, entityId); }
  reserveBudget(entityId: string, estimatedUsd: number, key: string, allowPaused = false): string {
    requireCondition((this.state.mode === 'live' || this.localInference && !!this.state.localInference) && (!this.state.paused || allowPaused), 'live_disabled', 'Paid actions require live activation and an unpaused world or trusted maintenance barrier');
    requireCondition(this.state.entities.some(entity => entity.id === entityId), 'not_found', 'Entity not found');
    requireCondition(Number.isFinite(estimatedUsd) && estimatedUsd > 0, 'invalid_amount', 'Reservation must be positive');
    const existing = this.state.reservations.find(item => item.id === key);

    if (existing) { requireCondition(existing.entityId === entityId && existing.estimatedUsd === estimatedUsd, 'idempotency_conflict', 'Reservation key conflict');
      requireCondition(dispatchDay(existing) === new Date(this.state.clock).toISOString().slice(0, 10), 'reservation_expired', 'Prior-day reservation cannot authorize a fresh dispatch');

 return existing.id; }

    this.rollBudgetDay();
    const entity = this.state.entities.find(item => item.id === entityId);
    requireCondition(this.entityCommitted(entityId) + estimatedUsd <= (entity?.dailyAllowanceUsd ?? 0), 'entity_budget_exhausted', 'Entity allowance cap exhausted; action not dispatched');

    requireCondition(this.state.budget.spentUsd + this.state.budget.reservedUsd + estimatedUsd <= this.state.budget.dailyUsd, 'budget_exhausted', 'Allowance exhausted; action not dispatched');
    this.state.reservations.push({ id: key, entityId, estimatedUsd, actualUsd: null, status: 'reserved', createdAt: this.state.clock });
    this.rollBudgetDay();

 return key;
  }
  /** Trusted fixed platform preparation only; never callable through model commands. */
  reservePlatformBaseline(estimatedUsd: number, key: string): string {
    requireCondition(this.state.mode === 'live' && this.state.paused, 'live_disabled', 'Platform baseline requires a paused live world');
    requireCondition(Number.isFinite(estimatedUsd) && estimatedUsd > 0 && estimatedUsd <= 0.05, 'invalid_amount', 'Baseline reservation must be bounded');
    requireCondition(!this.state.reservations.some(item => item.id === key), 'idempotency_conflict', 'Every baseline dispatch needs a fresh reservation');
    this.rollBudgetDay();
    requireCondition(this.state.budget.spentUsd + this.state.budget.reservedUsd + estimatedUsd <= this.state.budget.dailyUsd, 'budget_exhausted', 'World allowance exhausted; baseline not dispatched');
    this.state.reservations.push({ id: key, entityId: 'platform-bootstrap', estimatedUsd, actualUsd: null, status: 'reserved', createdAt: this.state.clock });
    this.rollBudgetDay();

    return key;
  }
  settleBudget(key: string, actualUsd: number): void {
    const reservation = this.state.reservations.find(item => item.id === key);
    requireCondition(Boolean(reservation), 'not_found', 'Reservation not found');

    if (!reservation) return;
    requireCondition(Number.isFinite(actualUsd) && actualUsd >= 0, 'invalid_amount', 'Measured settlement must be finite and nonnegative');

    if (reservation.status === 'settled') { requireCondition(reservation.actualUsd === actualUsd, 'idempotency_conflict', 'Settlement already recorded');

 return; }

    requireCondition(reservation.status === 'reserved', 'invalid_transition', 'Reservation already released');
    this.rollBudgetDay();
    reservation.actualUsd = actualUsd; reservation.status = 'settled'; reservation.settledAt = this.state.clock; this.rollBudgetDay();

    if (actualUsd > reservation.estimatedUsd) this.event({ role: 'system' }, 'budget.overrun', 'Measured provider cost exceeded its reserved estimate');
  }
  recordDeployment(deployment: Deployment): WorldState {
    requireCondition(this.state.mode === 'simulation' ? deployment.environment === 'simulation' : deployment.environment !== 'simulation', 'environment_mismatch', 'Simulation cannot record live deployments');
    requireCondition(!this.state.paused, 'paused', 'World is paused');
    const entity = this.state.entities.find(item => item.id === deployment.entityId);
    requireCondition(Boolean(entity), 'not_found', 'Entity not found');

    if (deployment.goalId) { const goal = this.goal(deployment.goalId, deployment.revision); requireCondition(goal.status === 'active' || goal.status === 'awaiting_acceptance', 'invalid_transition', 'Goal no longer publishable'); }

    const existing = this.state.deployments.find(item => item.id === deployment.id);

    if (existing) { requireCondition(JSON.stringify(existing) === JSON.stringify(deployment), 'idempotency_conflict', 'Deployment receipt conflict');

 return this.getState(); }

    const project = deployment.projectId ? this.state.projects?.find(item => item.id === deployment.projectId) : undefined;
    requireCondition(!deployment.projectId || Boolean(project), 'not_found', 'Shared project not found');

    if (deployment.goalId) requireCondition(this.state.goals.find(goal => goal.id === deployment.goalId)?.projectId === deployment.projectId, 'project_mismatch', 'Goal deployment targets a different project');
    requireCondition(deployment.version === (project?.siteVersion ?? entity?.siteVersion ?? 0) + 1, 'deployment_conflict', 'Outdated deployment version');
    this.state.deployments.push(structuredClone(deployment));

    if (project) project.siteVersion = deployment.version;
    else if (entity) entity.siteVersion = deployment.version;
    this.presence(deployment.entityId, 'publishing', 'Published a checked release');
    this.event({ role: 'system' }, 'deployment.published', deployment.projectId ? 'Shared website published' : 'Legacy entity website published', 'public');

 return this.getState();
  }
  replaceEvidenceSource(taskId: string, commit: string, deploymentId: string): void {
    requireCondition(/^[a-f0-9]{40}$/.test(commit), 'invalid_commit', 'Expected pinned Git commit');
    requireCondition(this.state.deployments.some(item => item.id === deploymentId && item.commit === commit), 'missing_deployment', 'Evidence needs a recorded deployment');

    for (const evidence of this.state.evidence) if (evidence.taskId === taskId && evidence.status === 'verified') { evidence.sourceCommit = commit; evidence.deploymentId = deploymentId; }
  }
}

const entitySchema = z.object({ id: z.string(), name: z.string(), role: z.string(), color: z.string(), description: z.string(), personality: z.array(z.string()), interests: z.array(z.string()), status: z.enum(['idle', 'working', 'paused']), siteVersion: z.number().int().nonnegative(), lastActiveAt: z.string().nullable(), dailyAllowanceUsd: z.number().nonnegative().max(1000).default(0), presence: entityPresenceSchema.optional() });

const revisionSchema = z.object({ revision: z.number().int().positive(), objective: z.string(), criteria: z.array(z.string()), constraints: z.array(z.string()), createdAt: z.string(), publicBrief: z.object({ text: z.string(), approvedAt: z.string(), approvalId: z.string() }).optional() });

export const worldStateSchema = z.object({
  visitorBuild: visitorBuildStateSchema.optional(),
  projects: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), repository: z.string(), siteVersion: z.number().int().nonnegative(), hostname: z.string().optional() })).optional(),
  localInference: localInferenceSchema.optional(), schemaVersion: z.literal(1), mode: z.enum(['simulation', 'live']), paused: z.boolean(), clock: z.iso.datetime(), entities: z.array(entitySchema),
  goals: z.array(z.object({ suggestionId: z.string().optional(), projectId: z.string().optional(), id: z.string(), status: z.enum(['draft', 'active', 'awaiting_acceptance', 'completed', 'paused', 'blocked', 'cancelled']), revision: z.number().int().positive(), revisions: z.array(revisionSchema), createdAt: z.string(), completedAt: z.string().nullable(), feedback: z.array(z.string()) })),
  tasks: z.array(z.object({ projectId: z.string().optional(), id: z.string(), goalId: z.string(), revision: z.number().int().positive(), entityId: z.string(), title: z.string(), status: z.enum(['queued', 'running', 'submitted', 'verified', 'blocked', 'superseded']), dependencies: z.array(z.string()), attempts: z.number().int().nonnegative(), evidenceIds: z.array(z.string()) })),
  relationships: z.array(z.object({ id: z.string(), entityId: z.string(), targetId: z.string(), label: z.string(), kind: z.literal('agent_claim'), eventIds: z.array(z.string()), createdAt: z.string() })).default([]),
  discussions: z.array(z.object({ origin: z.enum(['simulation', 'agent']).optional(), id: z.string(), entityId: z.string(), body: z.string(), createdAt: z.string(), visibility: z.enum(['public', 'private']), goalId: z.string().optional(), taskId: z.string().optional(), revision: z.number().int().positive().optional(), replyTo: z.string().optional() })),
  events: z.array(z.object({ id: z.string(), sequence: z.number().int().positive(), type: z.string(), actorId: z.string(), summary: z.string(), createdAt: z.string(), visibility: z.enum(['public', 'private']), goalId: z.string().optional() })),
  evidence: z.array(z.object({ reviewerId: z.string().optional(), reviewKind: z.literal('agent').optional(), observationId: z.string().optional(), id: z.string(), goalId: z.string(), revision: z.number().int().positive(), taskId: z.string(), entityId: z.string(), criterion: z.string(), sourceCommit: z.string(), environment: z.enum(['simulation', 'staging', 'production']), status: z.enum(['verified', 'failed', 'stale']), assertions: z.array(z.string()), createdAt: z.string(), deploymentId: z.string().optional() })),
  deployments: z.array(z.object({ authorship: z.enum(['platform', 'agent']).optional(), projectId: z.string().optional(), id: z.string(), entityId: z.string(), commit: z.string(), version: z.number().int().positive(), environment: z.enum(['simulation', 'staging', 'production']), status: z.enum(['published', 'rolled_back']), createdAt: z.string(), bundleHash: z.string(), goalId: z.string().optional(), revision: z.number().int().positive().optional(), taskId: z.string().optional(), workerName: z.string().optional() })),
  appointments: z.array(z.object({ id: z.string(), entityId: z.string(), role: z.enum(['steward', 'moderator']), expiresAt: z.string() })),
  personalityHistory: z.array(z.object({ id: z.string(), entityId: z.string(), trait: z.string(), rationale: z.string(), eventIds: z.array(z.string()), createdAt: z.string() })),
  confirmations: z.array(z.object({ entityId: z.string().optional(), taskId: z.string().optional(), id: z.string(), goalId: z.string(), revision: z.number().int().positive(), question: z.string(), status: z.enum(['pending', 'answered', 'superseded']), answer: z.string().optional() })),
  governance: z.array(z.object({ id: z.string(), entityId: z.string(), kind: z.enum(['proposal', 'moderation', 'appeal']), text: z.string(), createdAt: z.string(), targetId: z.string().optional(), expiresAt: z.string().optional() })),
  receipts: z.array(z.object({ id: z.string(), actorId: z.string(), tool: z.string(), status: z.enum(['succeeded', 'rejected']), createdAt: z.string(), mode: z.enum(['simulation', 'live']) })),
  reservations: z.array(z.object({ id: z.string(), entityId: z.string(), estimatedUsd: z.number().nonnegative(), actualUsd: z.number().nonnegative().nullable(), status: z.enum(['reserved', 'settled', 'released']), createdAt: z.string(), settledAt: z.string().optional() })),
  budget: z.object({ dailyUsd: z.number().nonnegative(), spentUsd: z.number().nonnegative(), reservedUsd: z.number().nonnegative(), day: z.string(), outstandingReservedUsd: z.number().nonnegative().optional(), accounting: z.object({ basis: z.literal('dispatch-day-v1'), legacyReservedUsd: z.number().nonnegative(), legacySpentByDay: z.array(z.object({ day: z.string(), usd: z.number().nonnegative() })) }).optional() }), processedCommands: z.record(z.string(), z.string()), turn: z.number().int().nonnegative(),
});

export function parseWorldState(input: string): WorldState { return worldStateSchema.parse(JSON.parse(input)); }
