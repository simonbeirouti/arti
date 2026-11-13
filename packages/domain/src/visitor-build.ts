import { frozenVisitorGoal } from './shared-reset';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Actor, Command, Deployment, Goal, WorldState } from '../../contracts/src/index';
import { reviewObservationSchema, visitorSchema, type PublicBuild, type ReviewObservation, type Suggestion, type Visitor } from '../../contracts/src/visitor-build';

function requireBuild(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const voters = ['moderator', 'researcher', 'steward'];

const publicTitles = new Map([['researcher', 'Research and provenance'], ['builder-1', 'Build service'], ['builder-2', 'Build public interface'], ['builder-3', 'Build application workflow'], ['builder-4', 'Integrate shared application'], ['moderator', 'Verify outcomes'], ['archivist', 'Publish verified guide'], ['steward', 'Assemble completion evidence']]);

export function suggestionScore(suggestion: Suggestion): number {
  return suggestion.votes.reduce((score, vote) => score + vote.usefulness + vote.fit + vote.feasibility, 0);
}

export function rankedSuggestions(suggestions: Suggestion[]): Suggestion[] {
  return suggestions.filter(item => item.status === 'eligible').sort((a, b) => suggestionScore(b) - suggestionScore(a) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Canonical state only. Browser identities are resolved by the HTTP adapter before entry. */
export class VisitorBuildAuthority {
  constructor(private readonly state: WorldState) {
    state.visitorBuild ??= { visitors: [], suggestions: [], submissions: [], observations: [], blockers: [] };
  }

  private data() {
    if (!this.state.visitorBuild) throw new Error('Visitor state unavailable');

    return this.state.visitorBuild;
  }

  visitor(id: string, name: string): Visitor {
    const visitor = visitorSchema.parse({ id, name });
    const existing = this.data().visitors.find(item => item.id === visitor.id);

    requireBuild(!!existing || this.data().visitors.length < 10000, 'Visitor capacity reached');

    if (existing) existing.name = visitor.name;
    else this.data().visitors.push(visitor);

    return structuredClone(visitor);
  }

  submit(visitorId: string, input: string, key: string, ipHash: string): Suggestion {
    const text = z.string().trim().min(10).max(2000).parse(input);
    z.string().min(8).max(200).parse(key);
    const data = this.data();
    const visitor = data.visitors.find(item => item.id === visitorId);
    requireBuild(!!visitor, 'Visitor session required');
    const now = Date.now();
    const fingerprint = createHash('sha256').update(text).digest('hex');
    const previous = data.submissions.find(item => item.visitorId === visitorId && item.key === key);

    if (previous) {
      requireBuild(previous.fingerprint === fingerprint, 'Idempotency conflict');
      const suggestion = data.suggestions.find(item => item.id === previous.suggestionId);
      requireBuild(!!suggestion, 'Suggestion receipt expired');

      return structuredClone(suggestion);
    }

    const recent = data.submissions.filter(item => Date.parse(item.createdAt) > now - 86400000 && (item.visitorId === visitorId || item.ipHash === ipHash));
    requireBuild(recent.length < 20 && recent.filter(item => Date.parse(item.createdAt) > now - 600000).length < 3, 'Suggestion rate limit reached');
    requireBuild(data.suggestions.filter(item => ['pending', 'reviewing', 'eligible', 'selected'].includes(item.status)).length < 100, 'Suggestion queue is full');
    requireBuild(data.visitors.length <= 10000, 'Visitor capacity reached');
    const suggestion: Suggestion = { id: `suggestion-${crypto.randomUUID()}`, visitorId, visitorName: visitor.name, text, createdAt: new Date(now).toISOString(), status: 'pending', votes: [] };
    data.suggestions.push(suggestion);
    data.submissions.push({ visitorId, ipHash, key, fingerprint, suggestionId: suggestion.id, createdAt: suggestion.createdAt });
    data.submissions = data.submissions.filter(item => Date.parse(item.createdAt) > now - 86400000);
    // Retain finite public history without discarding current queue entries.
    const closed = data.suggestions.filter(item => ['completed', 'rejected', 'duplicate'].includes(item.status));
    const expired = new Set(closed.slice(0, Math.max(0, closed.length - 200)).map(item => item.id));
    data.suggestions = data.suggestions.filter(item => !expired.has(item.id));

    return structuredClone(suggestion);
  }

  blockReview(entityId: string, goalId: string, revision: number): void {
    this.agent({ role: 'entity', entityId }, ['moderator', 'researcher']);
    const goal = this.goal(goalId, revision);
    const data = this.data();
    data.blockers = [...data.blockers.filter(item => item.goalId !== goal.id), { goalId, revision, reason: 'Independent review could not verify the published outcome. The team will retry; the owner can intervene.', createdAt: new Date().toISOString() }];
  }

  observe(input: ReviewObservation): void {
    const observation = reviewObservationSchema.parse(input);
    const goal = this.state.goals.find(item => item.id === observation.goalId && item.suggestionId && item.revision === observation.revision && ['active', 'awaiting_acceptance'].includes(item.status));
    const release = this.activeDeployment(goal?.projectId);
    requireBuild(!!goal && !!release && release.id === observation.deploymentId && release.commit === observation.commit && release.environment === observation.environment && release.entityId !== observation.reviewerId && voters.includes(observation.reviewerId), 'Observation does not match independently reviewed current release');
    requireBuild(release.goalId === goal.id && release.revision === goal.revision, 'Observation goal mismatch');
    requireBuild(Number.isFinite(Date.parse(observation.createdAt)) && Date.parse(observation.createdAt) > Date.now() - 600000 && Date.parse(observation.createdAt) <= Date.now() + 1000, 'Observation timestamp invalid');
    const data = this.data();
    data.observations = [...data.observations.filter(item => Date.parse(item.createdAt) > Date.now() - 600000), observation].slice(-100);
  }

  private activeDeployment(projectId?: string): Deployment | undefined {
    const project = this.state.projects?.find(item => item.id === projectId);

    return this.state.deployments.findLast(item => item.projectId === projectId && item.version === project?.siteVersion && item.status === 'published');
  }

  private agent(actor: Actor, allowed: string[]): string {
    requireBuild(actor.role === 'entity' && !!actor.entityId && allowed.includes(actor.entityId), 'Agent authority required');
    requireBuild(!this.state.paused, 'World is paused');

    return actor.entityId;
  }

  private goal(goalId: string, revision: number): Goal {
    const goal = this.state.goals.find(item => item.id === goalId && item.suggestionId && item.revision === revision && ['active', 'awaiting_acceptance'].includes(item.status));
    const suggestion = this.data().suggestions.find(item => item.id === goal?.suggestionId);
    requireBuild(!!goal && goal.revision === 1 && goal.revisions[0]?.publicBrief?.approvalId === `visitor-approval-${suggestion?.id}` && goal.revisions[0]?.objective === suggestion?.review?.brief, 'Current visitor goal required');

    return goal;
  }

  apply(actor: Actor, command: Command): Goal | null {
    const data = this.data();

    switch (command.type) {
      case 'suggestion.review': {
        this.agent(actor, ['moderator']);
        const suggestion = data.suggestions.find(item => item.id === command.suggestionId && item.status === 'pending');
        requireBuild(!!suggestion, 'Pending suggestion required');
        requireBuild(!command.duplicateOf || data.suggestions.some(item => item.id === command.duplicateOf && item.id !== suggestion.id), 'Duplicate target not found');
        requireBuild(command.rejected || !!command.duplicateOf || command.brief.length >= 10 && command.criteria.length > 0, 'Accepted proposal needs a brief and criteria');
        suggestion.review = { brief: command.brief, criteria: command.criteria, reason: command.reason, duplicateOf: command.duplicateOf };
        suggestion.status = command.duplicateOf ? 'duplicate' : command.rejected ? 'rejected' : 'reviewing';

        return null;
      }

      case 'suggestion.vote': {
        const entityId = this.agent(actor, voters);
        const suggestion = data.suggestions.find(item => item.id === command.suggestionId && ['reviewing', 'eligible'].includes(item.status) && item.review);
        requireBuild(!!suggestion, 'Reviewed suggestion required');
        const { type: _type, suggestionId: _id, ...vote } = command;
        suggestion.votes = [...suggestion.votes.filter(item => item.entityId !== entityId), { ...vote, entityId }];
        suggestion.status = suggestion.votes.filter(item => item.approved).length >= 2 ? 'eligible' : suggestion.votes.length === 3 ? 'rejected' : 'reviewing';

        return null;
      }

      case 'suggestion.select': {
        this.agent(actor, ['steward']);
        requireBuild(!this.state.goals.some(item => !['completed', 'cancelled'].includes(item.status) && (!this.state.visitorBuild?.sharedOnly || frozenVisitorGoal(this.state, item))), 'Finish the current goal first');
        const suggestion = rankedSuggestions(data.suggestions)[0];
        requireBuild(!!suggestion?.review, 'No eligible suggestion');
        const project = this.state.projects?.find(item => item.id === 'collective');
        requireBuild(!!project, 'Shared project required');
        const goal: Goal = { id: `goal-${suggestion.id}`, suggestionId: suggestion.id, projectId: project.id, status: 'active', revision: 1, revisions: [{ revision: 1, objective: suggestion.review.brief, criteria: [...suggestion.review.criteria], constraints: [], createdAt: this.state.clock, publicBrief: { text: suggestion.review.brief, approvalId: `visitor-approval-${suggestion.id}`, approvedAt: this.state.clock } }], createdAt: this.state.clock, completedAt: null, feedback: [] };
        this.state.goals.push(goal);
        suggestion.status = 'selected'; suggestion.goalId = goal.id;

        return goal;
      }

      case 'suggestion.task_review': {
        const task = this.state.tasks.find(item => item.id === command.taskId && item.revision === command.expectedRevision && item.status === 'submitted');
        requireBuild(!!task, 'Submitted current task required');
        const goal = this.goal(task.goalId, command.expectedRevision);
        const reviewer = this.agent(actor, task.entityId === 'moderator' ? ['researcher'] : ['moderator']);
        requireBuild(reviewer !== task.entityId && goal.status === 'active', 'Independent active review required');
        requireBuild(!command.approved || command.evidenceIds.length > 0, 'Approval needs checked task evidence');
        requireBuild(command.evidenceIds.every(id => task.evidenceIds.includes(id) && this.state.evidence.some(run => run.id === id && run.taskId === task.id && run.goalId === goal.id && run.revision === goal.revision && run.status === 'verified' && (this.state.mode === 'simulation' || run.environment !== 'simulation') && this.state.deployments.some(release => release.id === run.deploymentId && release.commit === run.sourceCommit && release.taskId === task.id && release.goalId === goal.id && release.revision === goal.revision && release.status === 'published'))), 'Checked task evidence required');
        task.status = command.approved ? 'verified' : task.attempts >= 3 ? 'blocked' : 'queued';

        if (task.status === 'blocked') goal.status = 'blocked';
        const id = `agent-task-review-${task.id}-${this.state.receipts.length}`;

        if (command.evidenceIds.length) this.state.evidence.push({ id, reviewerId: reviewer, reviewKind: 'agent', goalId: goal.id, revision: goal.revision, taskId: task.id, entityId: task.entityId, criterion: task.title, sourceCommit: this.state.evidence.find(item => item.id === command.evidenceIds[0])?.sourceCommit ?? '', environment: this.state.mode === 'simulation' ? 'simulation' : 'production', status: command.approved ? 'verified' : 'failed', assertions: ['Independent agent reviewed checked task evidence', command.feedback], createdAt: this.state.clock });

        return null;
      }

      case 'suggestion.verify': {
        const reviewer = this.agent(actor, ['moderator', 'researcher']);
        const goal = this.goal(command.goalId, command.expectedRevision);
        requireBuild(['active', 'awaiting_acceptance'].includes(goal.status) && this.state.tasks.filter(item => item.goalId === goal.id && item.revision === goal.revision).every(item => item.status === 'verified'), 'Verify all tasks before criteria');
        const criterion = goal.revisions.at(-1)?.criteria[command.criterionIndex];
        const release = this.activeDeployment(goal.projectId);
        requireBuild(!!criterion && !!release && release.id === command.deploymentId && release.goalId === goal.id && release.revision === goal.revision && release.entityId !== reviewer && (this.state.mode === 'simulation' || release.environment === 'production'), 'Current independent published release required');
        const observation = data.observations.find(item => item.id === command.observationId && item.goalId === goal.id && item.revision === goal.revision && item.deploymentId === release.id && item.commit === release.commit && item.reviewerId === reviewer && Date.parse(item.createdAt) > Date.now() - 600000);
        requireBuild(!!observation, 'Fresh trusted release observation required');
        data.blockers = data.blockers.filter(item => item.goalId !== goal.id || item.revision !== goal.revision);
        const task = this.state.tasks.find(item => item.goalId === goal.id && item.revision === goal.revision && item.entityId === 'steward');
        requireBuild(!!task, 'Completion task missing');
        this.state.evidence.push({ id: `agent-criterion-${goal.id}-${command.criterionIndex}-${this.state.receipts.length}`, reviewerId: reviewer, reviewKind: 'agent', observationId: observation.id, goalId: goal.id, revision: goal.revision, taskId: task.id, entityId: task.entityId, criterion, sourceCommit: release.commit, environment: release.environment, status: 'verified', deploymentId: release.id, assertions: ['Independent agent reviewed the observed published outcome', ...command.assertions], createdAt: this.state.clock });

        return null;
      }

      case 'suggestion.complete': {
        this.agent(actor, ['steward']);
        const goal = this.goal(command.goalId, command.expectedRevision);
        const release = this.activeDeployment(goal.projectId);
        const tasks = this.state.tasks.filter(item => item.goalId === goal.id && item.revision === goal.revision);
        requireBuild(!!release && release.goalId === goal.id && release.revision === goal.revision && tasks.length > 0 && tasks.every(item => item.status === 'verified'), 'Current checked goal release and tasks required');
        requireBuild(!!goal.revisions.at(-1)?.criteria.every(criterion => this.state.evidence.some(run => run.goalId === goal.id && run.revision === goal.revision && run.criterion === criterion && run.reviewKind === 'agent' && run.reviewerId !== release.entityId && run.observationId && run.status === 'verified' && run.deploymentId === release.id && run.sourceCommit === release.commit && (this.state.mode === 'simulation' || run.environment === 'production'))), 'Every criterion needs current independent evidence');
        goal.status = 'completed'; goal.completedAt = this.state.clock;
        const suggestion = data.suggestions.find(item => item.id === goal.suggestionId);

        if (suggestion) suggestion.status = 'completed';

        return null;
      }

      default: throw new Error('Unsupported visitor command');
    }
  }

  publicBuild(): PublicBuild {
    const state = this.state;
    const goal = state.goals.find(item => item.suggestionId && !['completed', 'cancelled'].includes(item.status) && (!state.visitorBuild?.sharedOnly || frozenVisitorGoal(state, item))) ?? state.goals.findLast(item => !!item.suggestionId && item.status === 'completed');
    const suggestion = this.data().suggestions.find(item => item.id === goal?.suggestionId);
    const tasks = goal ? state.tasks.filter(item => item.goalId === goal.id && item.revision === goal.revision) : [];
    const blocker = goal && goal.revision !== 1 ? { reason: 'The owner changed this goal. Automated public work is waiting for owner review.' } : this.data().blockers.find(item => item.goalId === goal?.id && item.revision === goal?.revision);
    const status = blocker ? 'blocked' : !goal ? 'queued' : state.paused || goal.status === 'paused' ? 'paused' : goal.status === 'completed' ? 'published' : goal.status === 'blocked' ? 'blocked' : tasks.every(item => item.status === 'verified') ? 'checking' : 'building';

    return structuredClone({ mode: state.mode, paused: state.paused, projects: state.projects ?? [], entities: state.entities.map(item => ({ ...item, dailyAllowanceUsd: undefined })), suggestions: this.data().suggestions, discussions: state.discussions.filter(item => item.visibility === 'public' && (state.mode === 'simulation' || item.origin === 'agent')), events: state.events.filter(item => item.visibility === 'public' && (item.type.startsWith('suggestion.') || item.type === 'website.baseline' && item.actorId === 'platform' && item.summary === 'Platform-provided Hello World starting page published' || item.type === 'deployment.published' && item.summary === 'Shared website published')), deployments: state.deployments.map(({ goalId: _goal, taskId: _task, revision: _revision, workerName: _worker, ...item }) => item), currentGoal: goal && suggestion?.review ? { id: goal.id, revision: goal.revision, title: suggestion.review.brief, suggestionId: suggestion.id, visitorName: suggestion.visitorName, status, blocker: blocker?.reason, tasks: tasks.map(item => ({ id: item.id, entityId: item.entityId, status: item.status, title: publicTitles.get(item.entityId) ?? 'Shared work' })) } : null });
  }
}
