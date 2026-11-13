import { describe, expect, it } from 'vitest';
import { WorldEngine, parseWorldState } from './index';
import { rankedSuggestions } from './visitor-build';
import type { Actor, Deployment } from '../../contracts/src/index';

const moderator: Actor = { role: 'entity', entityId: 'moderator' };

const researcher: Actor = { role: 'entity', entityId: 'researcher' };

const steward: Actor = { role: 'entity', entityId: 'steward' };

const operator: Actor = { role: 'operator' };

function reviewed(engine: WorldEngine, text = 'Add an accessible search to the shared website') {
  engine.upsertVisitor('visitor-one', 'Sam');
  const suggestion = engine.submitSuggestion('visitor-one', text, crypto.randomUUID(), 'ip-one');
  engine.dispatch(moderator, { type: 'suggestion.review', suggestionId: suggestion.id, brief: text, criteria: ['Search is visible on the published page'], reason: 'Useful improvement that fits the existing website', rejected: false }, crypto.randomUUID());

  return suggestion;
}

function vote(engine: WorldEngine, id: string, actor: Actor, approved = true, score = 4) {
  return engine.dispatch(actor, { type: 'suggestion.vote', suggestionId: id, approved, usefulness: score, fit: score, feasibility: score, reason: 'Fits the shared project and can be checked' }, crypto.randomUUID());
}

function selected() {
  const engine = new WorldEngine();
  const suggestion = reviewed(engine);
  vote(engine, suggestion.id, moderator);
  vote(engine, suggestion.id, researcher);
  engine.dispatch(steward, { type: 'suggestion.select' }, crypto.randomUUID());

  return engine;
}

function checkedFixture() {
  const engine = selected();
  const state = engine.getState();
  state.mode = 'live';
  const goal = state.goals[0]!;

  for (const task of state.tasks) task.status = 'verified';
  const release: Deployment = { id: 'published-release', goalId: goal.id, revision: goal.revision, projectId: goal.projectId, entityId: 'steward', taskId: state.tasks.at(-1)?.id, commit: 'a'.repeat(40), bundleHash: 'b'.repeat(64), version: 1, status: 'published', environment: 'production', authorship: 'agent', createdAt: state.clock };
  const checked = new WorldEngine(state);
  checked.recordDeployment(release);
  checked.recordReviewObservation({ id: 'observed-release', goalId: goal.id, revision: goal.revision, deploymentId: release.id, reviewerId: 'moderator', commit: release.commit, contentHash: 'c'.repeat(64), createdAt: new Date().toISOString(), environment: 'production' });

  return { engine: checked, goal, release };
}

describe('canonical visitor suggestion lifecycle', () => {
  it('derives attribution from stored visitor identity and persists idempotency through restart', () => {
    const engine = new WorldEngine();
    expect(() => engine.submitSuggestion('forged', 'An improvement to the website', 'submission-one', 'ip')).toThrow('session');
    engine.upsertVisitor('real-visitor', 'Taylor');
    const suggestion = engine.submitSuggestion('real-visitor', 'An improvement to the website', 'submission-one', 'ip');
    const restored = new WorldEngine(parseWorldState(JSON.stringify(engine.getState())));
    expect(restored.submitSuggestion('real-visitor', suggestion.text, 'submission-one', 'ip')).toEqual(suggestion);
    expect(() => restored.submitSuggestion('real-visitor', 'Different suggested improvement', 'submission-one', 'ip')).toThrow('Idempotency');
    restored.upsertVisitor('real-visitor', 'New name');
    expect(restored.getPublicBuild().suggestions[0]?.visitorName).toBe('Taylor');
    expect(JSON.stringify(restored.getPublicBuild())).not.toContain('submissions');
  });

  it('enforces visitor and aggregate IP limits and the pending queue bound', () => {
    const engine = new WorldEngine();

    for (let n = 0; n < 3; n += 1) {
      engine.upsertVisitor(`visitor-${n}`, 'Visitor');
      engine.submitSuggestion(`visitor-${n}`, `Useful improvement number ${n}`, `submission-${n}`, 'shared-ip');
    }

    engine.upsertVisitor('visitor-four', 'Visitor');
    expect(() => engine.submitSuggestion('visitor-four', 'Another useful improvement', 'submission-four', 'shared-ip')).toThrow('rate limit');
    const daily = engine.getState();
    const submission = daily.visitorBuild!.submissions[0]!;
    daily.visitorBuild!.submissions = Array.from({ length: 20 }, (_, n) => ({ ...submission, visitorId: 'visitor-four', ipHash: 'daily-ip', key: `daily-${n}`, createdAt: new Date(Date.now() - 3600000).toISOString() }));
    expect(() => new WorldEngine(daily).submitSuggestion('visitor-four', 'One more daily improvement', 'daily-exhausted', 'daily-ip')).toThrow('rate limit');
    const full = engine.getState();
    const first = full.visitorBuild!.suggestions[0]!;
    full.visitorBuild!.suggestions = Array.from({ length: 100 }, (_, n) => ({ ...first, id: `pending-${n}` }));
    expect(() => new WorldEngine(full).submitSuggestion('visitor-four', 'Another useful improvement', 'submission-full', 'new-ip')).toThrow('queue');
  });

  it('keeps review authority scoped, freezes briefs, links duplicates and replaces votes', () => {
    const engine = new WorldEngine();
    const suggestion = reviewed(engine);
    expect(() => vote(engine, suggestion.id, { role: 'entity', entityId: 'builder-1' })).toThrow('Agent authority');
    vote(engine, suggestion.id, moderator);
    vote(engine, suggestion.id, moderator, false, 1);
    expect(engine.getPublicBuild().suggestions[0]?.votes).toHaveLength(1);
    expect(engine.getPublicBuild().suggestions[0]?.status).toBe('reviewing');
    expect(() => engine.dispatch(moderator, { type: 'suggestion.review', suggestionId: suggestion.id, brief: 'Replace a frozen reviewed proposal', criteria: ['New criterion'], rejected: false, reason: 'A different reviewed proposal' }, crypto.randomUUID())).toThrow('Pending');
    const duplicate = engine.submitSuggestion('visitor-one', 'Another proposal for search', crypto.randomUUID(), 'ip-one');
    engine.dispatch(moderator, { type: 'suggestion.review', suggestionId: duplicate.id, brief: '', criteria: [], reason: 'Already covered by the existing proposal', rejected: false, duplicateOf: suggestion.id }, crypto.randomUUID());
    expect(engine.getPublicBuild().suggestions[1]?.status).toBe('duplicate');
  });

  it('selects by rank with deterministic ties and prevents concurrent starts', () => {
    const engine = new WorldEngine();
    const first = reviewed(engine);
    const second = reviewed(engine, 'Improve navigation on the existing shared website');

    for (const proposal of [first, second]) { vote(engine, proposal.id, moderator); vote(engine, proposal.id, researcher); }

    const proposals = engine.getState().visitorBuild!.suggestions;
    const equalTime = proposals.map(item => ({ ...item, createdAt: '2026-10-17T00:00:00.000Z' }));
    expect(rankedSuggestions(equalTime).map(item => item.id)).toEqual(equalTime.map(item => item.id).sort((a, b) => a.localeCompare(b)));
    const ranked = rankedSuggestions(proposals);
    const state = engine.dispatch(steward, { type: 'suggestion.select' }, 'select-next-stable');
    expect(state.goals[0]?.suggestionId).toBe(ranked[0]?.id);
    expect(engine.dispatch(steward, { type: 'suggestion.select' }, 'select-next-stable').goals).toHaveLength(1);
    expect(() => engine.dispatch(steward, { type: 'suggestion.select' }, 'select-another-key')).toThrow('current goal');
    expect(() => engine.dispatch(operator, { type: 'suggestion.select' }, 'select-as-operator')).toThrow('Agent authority');
    expect(engine.getState().tasks).toHaveLength(8);
  });

  it('rejects private content and does not expose task edits, operational metadata or private revisions', () => {
    const engine = new WorldEngine();
    engine.dispatch(operator, { type: 'goal.create', objective: 'PRIVATE GOAL CANARY', criteria: ['PRIVATE CRITERION CANARY'], constraints: [] }, 'private-goal-create');
    const privateGoal = engine.getState().goals[0]!;
    engine.upsertVisitor('visitor', 'Public name');
    expect(() => engine.submitSuggestion('visitor', 'Please publish PRIVATE GOAL CANARY', 'private-submission', 'ip')).toThrow('private goal');
    engine.dispatch(operator, { type: 'goal.start', goalId: privateGoal.id }, 'private-goal-start');
    engine.dispatch(operator, { type: 'goal.control', goalId: privateGoal.id, expectedRevision: 1, action: 'cancel', feedback: '' }, 'private-goal-cancel');
    const suggestion = reviewed(engine);
    vote(engine, suggestion.id, moderator); vote(engine, suggestion.id, researcher);
    engine.dispatch(steward, { type: 'suggestion.select' }, 'visitor-goal-select');
    const state = engine.getState();
    state.tasks.at(-1)!.title = 'PRIVATE TASK CANARY';
    const restored = new WorldEngine(state);
    const projection = JSON.stringify(restored.getPublicBuild());
    expect(projection).not.toContain('PRIVATE');
    expect(projection).not.toContain('reservations');
    const goal = state.goals.at(-1)!;
    restored.dispatch(operator, { type: 'goal.revise', goalId: goal.id, expectedRevision: 1, objective: 'PRIVATE REVISED CANARY', criteria: ['Private changed criterion'], constraints: [] }, 'visitor-private-revise');
    expect(JSON.stringify(restored.getPublicBuild())).not.toContain('PRIVATE');
  });

  it('requires checked task evidence and forbids self or unrelated review', () => {
    const engine = selected();
    const state = engine.getState();
    const task = state.tasks[0]!;
    task.status = 'submitted';
    const pending = new WorldEngine(state);
    const command = { type: 'suggestion.task_review', taskId: task.id, expectedRevision: 1, approved: true, feedback: 'Independently checked submitted work', evidenceIds: ['invented-evidence'] } as const;
    expect(() => pending.dispatch(researcher, { ...command, evidenceIds: [...command.evidenceIds] }, crypto.randomUUID())).toThrow('Agent authority');
    expect(() => pending.dispatch(moderator, { ...command, evidenceIds: [...command.evidenceIds] }, crypto.randomUUID())).toThrow('Checked task evidence');
    const rejected = pending.dispatch(moderator, { ...command, approved: false, evidenceIds: [] }, crypto.randomUUID());
    expect(rejected.tasks[0]?.status).toBe('queued');
  });

  it('requires actual independent observed publication and exact current criteria evidence before completion', () => {
    const { engine, goal, release } = checkedFixture();
    expect(() => engine.dispatch(steward, { type: 'suggestion.complete', goalId: goal.id, expectedRevision: 1 }, crypto.randomUUID())).toThrow('Every criterion');
    const verify = { type: 'suggestion.verify', goalId: goal.id, expectedRevision: 1, criterionIndex: 0, deploymentId: release.id, observationId: 'observed-release', assertions: ['Search control is visible in observed published HTML'] } as const;
    expect(() => engine.dispatch(moderator, { ...verify, observationId: 'forged', assertions: [...verify.assertions] }, crypto.randomUUID())).toThrow('observation');
    engine.dispatch(moderator, { ...verify, assertions: [...verify.assertions] }, 'verify-observed-criterion');
    expect(engine.getState().goals[0]?.status).toBe('awaiting_acceptance');
    expect(engine.getState().evidence.at(-1)?.assertions.join(' ')).not.toContain('Operator');
    const completed = engine.dispatch(steward, { type: 'suggestion.complete', goalId: goal.id, expectedRevision: 1 }, 'complete-observed-goal');
    expect(completed.goals[0]?.status).toBe('completed');
    expect(completed.visitorBuild?.suggestions[0]?.status).toBe('completed');
  });

  it('rejects stale, rolled-back and simulated release evidence in live mode', () => {
    const { engine, goal, release } = checkedFixture();
    const verify = { type: 'suggestion.verify', goalId: goal.id, expectedRevision: 1, criterionIndex: 0, deploymentId: release.id, observationId: 'observed-release', assertions: ['Observed published search interface'] } as const;
    const newer = { ...release, id: 'newer-release', version: 2, commit: 'd'.repeat(40) };
    engine.recordDeployment(newer);
    expect(() => engine.dispatch(moderator, { ...verify, assertions: [...verify.assertions] }, crypto.randomUUID())).toThrow(/current/i);
    const state = engine.getState();
    state.deployments.at(-1)!.status = 'rolled_back';
    expect(() => new WorldEngine(state).dispatch(moderator, { ...verify, assertions: [...verify.assertions] }, crypto.randomUUID())).toThrow(/current/i);
    const simulation = checkedFixture();
    const simulated = simulation.engine.getState();
    simulated.deployments[0]!.environment = 'simulation';
    expect(() => new WorldEngine(simulated).dispatch(moderator, { ...verify, assertions: [...verify.assertions] }, crypto.randomUUID())).toThrow(/current/i);
  });

  it('preserves pause and role boundaries and loads snapshots without visitor state', () => {
    const engine = selected();
    engine.dispatch(operator, { type: 'world.pause', paused: true }, 'pause-proposal-world');
    expect(() => engine.dispatch(steward, { type: 'suggestion.complete', goalId: engine.getState().goals[0]!.id, expectedRevision: 1 }, crypto.randomUUID())).toThrow('paused');
    const legacy = engine.getState();
    delete legacy.visitorBuild;
    expect(new WorldEngine(parseWorldState(JSON.stringify(legacy))).getPublicBuild().suggestions).toEqual([]);
  });
});
