import { expect, it } from 'vitest';
import { createInitialState, WorldEngine } from './index';
import { resetSharedPublicState } from './shared-reset';

function publicWorld() {
  const state = createInitialState(); state.mode = 'live'; state.paused = true; state.clock = new Date().toISOString(); state.budget.dailyUsd = 5;
  state.visitorBuild = { visitors: [{ id: 'visitor', name: 'Avery' }], suggestions: [{ id: 'proposal', visitorId: 'visitor', visitorName: 'Avery', text: 'Build a useful public calendar', createdAt: state.clock, status: 'selected', review: { brief: 'Build a public calendar', criteria: ['A calendar is visible'], reason: 'Useful bounded improvement' }, votes: [] }], observations: [], submissions: [], blockers: [] };
  state.goals = [{ id: 'public-goal', suggestionId: 'proposal', projectId: 'collective', status: 'active', revision: 1, revisions: [{ revision: 1, objective: 'Build a public calendar', criteria: ['A calendar is visible'], constraints: [], createdAt: state.clock, publicBrief: { text: 'Build a public calendar', approvalId: 'visitor-approval-proposal', approvedAt: state.clock } }], createdAt: state.clock, completedAt: null, feedback: [] }];

  return state;
}

it('clears public visitor work while retaining names, private goals and every financial receipt', () => {
  const state = publicWorld();
  state.goals.push({ id: 'private-goal', status: 'active', revision: 1, revisions: [{ revision: 1, objective: 'PRIVATE objective', criteria: ['PRIVATE criterion'], constraints: [], createdAt: state.clock }], createdAt: state.clock, completedAt: null, feedback: [] });
  state.tasks = [
    { id: 'public-task', goalId: 'public-goal', revision: 1, entityId: 'builder-1', title: 'Public task', status: 'running', dependencies: [], attempts: 1, evidenceIds: [] },
    { id: 'private-task', goalId: 'private-goal', revision: 1, entityId: 'researcher', title: 'PRIVATE task', status: 'queued', dependencies: [], attempts: 0, evidenceIds: [] },
  ];
  state.reservations = [{ id: 'unknown-usage', entityId: 'researcher', status: 'reserved', actualUsd: null, estimatedUsd: 0.1, createdAt: state.clock }];
  state.discussions = [{ id: 'public', entityId: 'steward', body: 'Old public chat', visibility: 'public', createdAt: state.clock }, { id: 'private', entityId: 'researcher', body: 'PRIVATE memory', visibility: 'private', goalId: 'private-goal', createdAt: state.clock }];
  state.events = [{ id: 'old-public', sequence: 1, actorId: 'steward', type: 'social.post', summary: 'Old public event', visibility: 'public', createdAt: state.clock }];
  const fresh = resetSharedPublicState(state);
  expect(fresh.goals.map(item => item.id)).toEqual(['private-goal']);
  expect(fresh.tasks.map(item => item.id)).toEqual(['private-task']);
  expect(fresh.discussions.map(item => item.id)).toEqual(['private']);
  expect(fresh.events).toEqual([]);
  expect(fresh.visitorBuild).toMatchObject({ sharedOnly: true, visitors: state.visitorBuild!.visitors, suggestions: [], submissions: [], observations: [], blockers: [] });
  expect(fresh.reservations).toEqual(state.reservations);
  expect(fresh.budget).toEqual(state.budget);
  expect(fresh.processedCommands).toEqual(state.processedCommands);
  expect(fresh.projects![0].siteVersion).toBe(0);
});

it('preserves an operator-revised visitor goal that contains private material', () => {
  const state = publicWorld(); state.goals[0].revision = 2;
  state.goals[0].revisions.push({ revision: 2, objective: 'PRIVATE revised objective', criteria: ['PRIVATE revised criterion'], constraints: [], createdAt: state.clock });
  expect(resetSharedPublicState(state).goals).toEqual(state.goals);
  state.paused = false;
  expect(() => resetSharedPublicState(state)).toThrow('Pause');
});

it('allows a fresh public goal beside preserved private work without publishing private records', () => {
  const state = publicWorld(); state.goals[0].revision = 2; state.goals[0].revisions.push({ revision: 2, objective: 'PRIVATE objective', criteria: ['PRIVATE criterion'], constraints: [], createdAt: state.clock });
  const fresh = resetSharedPublicState(state); fresh.paused = false;
  const engine = new WorldEngine(fresh);
  const suggestion = engine.submitSuggestion('visitor', 'Build a useful public weather page', 'new-proposal-key', 'ip-reset');
  engine.dispatch({ role: 'entity', entityId: 'moderator' }, { type: 'suggestion.review', suggestionId: suggestion.id, brief: 'Build a useful public weather page', criteria: ['Shows public weather'], reason: 'A useful bounded improvement', rejected: false }, 'new-review-key');

  for (const entityId of ['moderator', 'researcher']) engine.dispatch({ role: 'entity', entityId }, { type: 'suggestion.vote', suggestionId: suggestion.id, approved: true, usefulness: 5, fit: 5, feasibility: 5, reason: 'A feasible public improvement' }, `new-vote-${entityId}`);
  engine.dispatch({ role: 'entity', entityId: 'steward' }, { type: 'suggestion.select' }, 'new-select-key');
  expect(engine.getState().goals).toHaveLength(2);
  expect(engine.getPublicBuild().currentGoal?.suggestionId).toBe(suggestion.id);
  expect(JSON.stringify(engine.getPublicBuild())).not.toContain('PRIVATE');
});

it('charges fixed platform preparation to the global daily cap without impersonating an agent', () => {
  const engine = new WorldEngine(publicWorld());
  engine.reservePlatformBaseline(0.02, 'fixed-platform-preparation');
  expect(engine.getState().reservations.at(-1)).toMatchObject({ entityId: 'platform-bootstrap', actualUsd: null, status: 'reserved' });
  expect(engine.getState().entities.every(entity => entity.dailyAllowanceUsd === 0)).toBe(true);
  expect(() => engine.reservePlatformBaseline(0.02, 'fixed-platform-preparation')).toThrow('fresh');
});
