import { describe, expect, it } from 'vitest';
import { createInitialState, parseWorldState, WorldEngine } from '../../../../packages/domain/src/index';
import type { Actor, WorldState } from '../../../../packages/contracts/src/index';
import { privateAssignment, publicAssignment, authorizePublicAssignment } from './assignment';

const operator: Actor = { role: 'operator' };

const researcher: Actor = { role: 'entity', entityId: 'researcher' };

function submittedResearch() {
  const state = createInitialState();
  state.mode = 'live';
  const engine = new WorldEngine(state);
  engine.dispatch(operator, { type: 'goal.create', objective: 'Create an independently checked resource', criteria: ['Checked working resource'], constraints: [] }, 'create-goal');
  const goal = engine.getState().goals[0];

  if (!goal) throw new Error('Missing goal fixture');
  engine.dispatch(operator, { type: 'goal.start', goalId: goal.id }, 'start-goal');
  const task = engine.getState().tasks.find(item => item.entityId === 'researcher');

  if (!task) throw new Error('Missing task fixture');
  engine.dispatch(researcher, { type: 'task.claim', taskId: task.id, expectedRevision: 1 }, 'claim-research');
  engine.dispatch(researcher, { type: 'task.submit', taskId: task.id, expectedRevision: 1, summary: 'Source provenance and findings ready for independent review' }, 'submit-research');

  return { engine, goal, task };
}

function approvedResearch() {
  const fixture = submittedResearch();
  fixture.engine.dispatch(operator, { type: 'task.review', taskId: fixture.task.id, expectedRevision: 1, approved: true, feedback: 'Independently inspected saved provenance' }, 'review-research');

  return fixture;
}

describe('private dependency handoffs', () => {
  it('keeps builders asleep after submission until the operator independently reviews', () => {
    const { engine, task } = submittedResearch();
    expect(privateAssignment(engine.getState(), 'builder-1')).toBeNull();
    expect(privateAssignment(engine.getState(), 'builder-2')).toBeNull();
    expect(() => engine.dispatch(researcher, { type: 'task.review', taskId: task.id, expectedRevision: 1, approved: true, feedback: 'Self approval' }, 'self-review')).toThrow('Operator');
    engine.dispatch(operator, { type: 'task.review', taskId: task.id, expectedRevision: 1, approved: true, feedback: 'Independently checked source provenance' }, 'independent-review');
    expect(privateAssignment(engine.getState(), 'builder-1')?.dependencyHandoffs[0]?.submissions[0]?.body).toContain('Source provenance');
    expect(privateAssignment(engine.getState(), 'builder-2')?.dependencyHandoffs).toHaveLength(1);
    const restored = parseWorldState(JSON.stringify(engine.getState()));
    expect(privateAssignment(restored, 'builder-1')?.dependencyHandoffs[0]?.submissions).toHaveLength(1);
    expect(engine.getPublicState().discussions).toHaveLength(0);
  });

  it('passes exact current dependency records and fails closed on unscoped or mismatched private records', () => {
    const { engine, goal, task } = approvedResearch();
    const state = engine.getState();
    const submission = state.discussions[0];
    const dependency = state.tasks.find(item => item.id === task.id);

    if (!submission || !dependency) throw new Error('Missing submitted dependency');
    state.discussions.push(
      { ...submission, id: 'unscoped', taskId: undefined, revision: undefined, body: 'Legacy private text' },
      { ...submission, id: 'old-revision', revision: 2, body: 'Other revision private text' },
      { ...submission, id: 'other-goal', goalId: 'different-goal', body: 'Other goal private text' },
      { ...submission, id: 'other-entity', entityId: 'moderator', body: 'Other identity private text' },
      { ...submission, id: 'unrelated-task', taskId: 'different-task', body: 'Unrelated private text' },
      { ...submission, id: 'public-message', visibility: 'public', body: 'Unreviewed public conversation' },
    );
    const evidence: WorldState['evidence'][number] = { id: 'checked', goalId: goal.id, revision: 1, taskId: task.id, entityId: task.entityId, criterion: task.title, sourceCommit: 'a'.repeat(40), environment: 'staging', status: 'verified', assertions: ['Checked saved provenance'], createdAt: state.clock, deploymentId: 'release' };
    state.evidence.push(evidence, { ...evidence, id: 'stale', status: 'stale' }, { ...evidence, id: 'wrong-evidence', taskId: 'unrelated' });
    dependency.evidenceIds = ['checked', 'stale', 'wrong-evidence'];
    const deployment: WorldState['deployments'][number] = { id: 'release', entityId: task.entityId, commit: 'a'.repeat(40), version: 1, environment: 'staging', status: 'published', createdAt: state.clock, bundleHash: 'b'.repeat(64), goalId: goal.id, revision: 1 };
    state.deployments.push(deployment, { ...deployment, id: 'unrelated-release' }, { ...deployment, id: 'old-release', taskId: task.id, revision: 2 }, { ...deployment, id: 'rolled-back', taskId: task.id, status: 'rolled_back' });
    state.confirmations.push({ id: 'dependency-answer', taskId: task.id, goalId: goal.id, revision: 1, question: 'Private direction', status: 'answered', answer: 'Not shared with downstream agents' });
    const handoff = privateAssignment(state, 'builder-1');
    expect(handoff?.dependencyHandoffs[0]?.submissions.map(item => item.id)).toEqual([submission.id]);
    expect(handoff?.dependencyHandoffs[0]?.evidence.map(item => item.id)).toEqual(['checked']);
    expect(handoff?.dependencyHandoffs[0]?.deployments.map(item => item.id)).toEqual(['release']);
    expect(handoff?.confirmations).toEqual([]);
    expect(JSON.stringify(handoff)).not.toContain('Not shared with downstream agents');
  });

  it('rejects foreign revision dependency references and unknown or unassigned entities', () => {
    const { engine, task } = approvedResearch();
    const state = engine.getState();
    const dependency = state.tasks.find(item => item.id === task.id);

    if (!dependency) throw new Error('Missing dependency');
    dependency.revision = 2;
    expect(privateAssignment(state, 'builder-1')).toBeNull();
    expect(privateAssignment(state, 'invented-identity')).toBeNull();
    expect(privateAssignment(state, 'archivist')).toBeNull();
  });
});

it('shared-only mode denies an older private public-brief scope and selects the new frozen visitor assignment', () => {
  const engine = new WorldEngine();
  const state = engine.getState();
  state.visitorBuild = { sharedOnly: true, visitors: [], suggestions: [{ id: 'fresh', visitorId: 'visitor', visitorName: 'Avery', text: 'Build a public page', createdAt: state.clock, status: 'selected', review: { brief: 'Build a public page', criteria: ['A heading appears'], reason: 'A useful addition' }, votes: [] }], submissions: [], observations: [], blockers: [] };
  state.goals = [
    { id: 'old-private', status: 'active', revision: 1, revisions: [{ revision: 1, objective: 'PRIVATE objective', criteria: ['PRIVATE criterion'], constraints: [], createdAt: state.clock, publicBrief: { text: 'An older operator-approved brief', approvalId: 'old-approval', approvedAt: state.clock } }], createdAt: state.clock, completedAt: null, feedback: [] },
    { id: 'new-public', projectId: 'collective', suggestionId: 'fresh', status: 'active', revision: 1, revisions: [{ revision: 1, objective: 'Build a public page', criteria: ['A heading appears'], constraints: [], createdAt: state.clock, publicBrief: { text: 'Build a public page', approvalId: 'visitor-approval-fresh', approvedAt: state.clock } }], createdAt: state.clock, completedAt: null, feedback: [] },
  ];
  state.tasks = [
    { id: 'private-task', goalId: 'old-private', revision: 1, entityId: 'researcher', title: 'PRIVATE task', status: 'queued', dependencies: [], attempts: 0, evidenceIds: [] },
    { id: 'public-task', projectId: 'collective', goalId: 'new-public', revision: 1, entityId: 'researcher', title: 'Public work', status: 'queued', dependencies: [], attempts: 0, evidenceIds: [] },
  ];
  expect(publicAssignment(state, 'researcher')?.scope.taskId).toBe('public-task');
  expect(privateAssignment(state, 'researcher')).toBeNull();
  expect(() => authorizePublicAssignment(state, 'researcher', { goalId: 'old-private', revision: 1, taskId: 'private-task', approvalId: 'old-approval' })).toThrow('no longer authorized');
});
