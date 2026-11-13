import { expect, it } from 'vitest';
import { createInitialState } from '../../../../packages/domain/src/index';
import { governanceContext, governanceLane, requireGovernanceAction } from './governance';
import { reviewContent, reviewDeployment, validateObservation } from './observation';

function world() {
  const state = createInitialState(); state.mode = 'live';
  state.visitorBuild = { visitors: [], suggestions: [{ id: 'suggestion-1', visitorId: 'visitor-1', visitorName: 'Visitor', text: 'Add a useful project page', createdAt: state.clock, status: 'pending', votes: [] }], submissions: [], observations: [], blockers: [] };

  return state;
}

it('reviews during active builds with a fresh public context and trusted identity', () => {
  const state = world();
  state.goals.push({ id: 'private', status: 'active', revision: 1, createdAt: state.clock, completedAt: null, feedback: [], revisions: [{ revision: 1, objective: 'PRIVATE-CANARY', criteria: ['PRIVATE-CRITERION'], constraints: [], createdAt: state.clock }] });
  state.discussions.push({ id: 'private-post', entityId: 'researcher', body: 'SECRET-CANARY', visibility: 'private', createdAt: state.clock });
  const context = governanceContext(state, 'moderator');
  expect(context?.action).toEqual({ type: 'suggestion.review', suggestionId: 'suggestion-1' });
  expect(context?.content).not.toContain('CANARY');
  expect(governanceContext(state, 'builder-1')).toBeNull();
  state.paused = true;
  expect(governanceContext(state, 'moderator')).toBeNull();
});

it('does not repeat votes or interrupt an unfinished goal with selection', () => {
  const state = world(); const suggestion = state.visitorBuild!.suggestions[0];
  suggestion.status = 'eligible'; suggestion.review = { brief: 'Add a useful page', criteria: ['Shows a project heading'], reason: 'Fits the project' };
  suggestion.votes = [{ entityId: 'researcher', approved: true, usefulness: 4, fit: 4, feasibility: 4, reason: 'A useful improvement' }];
  expect(governanceContext(state, 'researcher')).toBeNull();
  expect(governanceContext(state, 'steward')?.action.type).toBe('suggestion.vote');
  suggestion.votes.push({ entityId: 'steward', approved: true, usefulness: 4, fit: 4, feasibility: 4, reason: 'A feasible improvement' });
  expect(governanceContext(state, 'steward')?.action.type).toBe('suggestion.select');
});

it('reserves two minutes in three for builders without suppressing idle reviews', () => {
  expect([0, 60000, 120000].map(time => governanceLane(time, true))).toEqual([true, false, false]);
  expect(governanceLane(60000, false)).toBe(true);
  expect(() => requireGovernanceAction({ type: 'suggestion.vote', suggestionId: 'one' }, { type: 'suggestion.select' })).toThrow('changed');
});

it('requires the exact current independent immutable published revision', () => {
  const state = world();
  state.visitorBuild!.suggestions[0].review = { brief: 'Public page', criteria: ['A heading appears'], reason: 'Useful page' };
  state.projects![0].siteVersion = 1;
  state.goals.push({ id: 'goal', suggestionId: 'suggestion-1', projectId: 'collective', status: 'active', revision: 1, revisions: [{ revision: 1, objective: 'Public page', criteria: ['A heading appears'], constraints: [], createdAt: state.clock, publicBrief: { text: 'Public page', approvalId: 'visitor-approval-suggestion-1', approvedAt: state.clock } }], createdAt: state.clock, completedAt: null, feedback: [] });
  state.deployments.push({ id: 'deployment', projectId: 'collective', entityId: 'builder-1', commit: 'commit', version: 1, environment: 'production', status: 'published', createdAt: state.clock, bundleHash: 'hash', goalId: 'goal', revision: 1, workerName: 'collective-hash' });
  expect(reviewDeployment(state, 'moderator', 'goal', 1).deployment.id).toBe('deployment');
  expect(() => reviewDeployment(state, 'builder-1', 'goal', 1)).toThrow('authorized');
  state.deployments[0].entityId = 'moderator';
  expect(() => reviewDeployment(state, 'moderator', 'goal', 1)).toThrow('Independent');
  state.deployments[0].entityId = 'builder-1';
  expect(() => validateObservation(state, { id: 'observation', reviewerId: 'moderator', goalId: 'goal', revision: 1, deploymentId: 'deployment', commit: 'old', bundleHash: 'hash', createdAt: new Date().toISOString(), status: 200, content: '<h1>Page</h1>' })).toThrow('stale');
});

it('bounds actual content and rejects redirects, binary output and error pages', async () => {
  await expect(reviewContent(new Response('<h1>Published</h1>', { headers: { 'content-type': 'text/html' } }))).resolves.toContain('Published');
  await expect(reviewContent(new Response('x'.repeat(24001), { headers: { 'content-type': 'text/plain' } }))).rejects.toThrow('limit');
  await expect(reviewContent(new Response('', { status: 302, headers: { location: 'https://private.invalid' } }))).rejects.toThrow('successful');
  await expect(reviewContent(new Response('binary', { headers: { 'content-type': 'image/png' } }))).rejects.toThrow('successful');
});

it('never reads operator-revised private goals or task titles into governance', () => {
  const state = world(); const proposal = state.visitorBuild!.suggestions[0];
  proposal.status = 'selected'; proposal.review = { brief: 'Public page', criteria: ['Public heading'], reason: 'Useful addition' };
  state.goals.push({ id: 'goal', suggestionId: proposal.id, projectId: 'collective', status: 'active', revision: 2, revisions: [{ revision: 2, objective: 'PRIVATE-OBJECTIVE-CANARY', criteria: ['PRIVATE-CRITERION-CANARY'], constraints: [], createdAt: state.clock }], completedAt: null, createdAt: state.clock, feedback: [] });
  state.tasks.push({ id: 'task', goalId: 'goal', revision: 2, entityId: 'builder-1', title: 'PRIVATE-TITLE-CANARY', status: 'submitted', dependencies: [], attempts: 1, evidenceIds: [] });
  expect(governanceContext(state, 'moderator')).toBeNull();
  expect(() => reviewDeployment(state, 'moderator', 'goal', 2)).toThrow('authorized');
});

it('schedules a missing-evidence submitted task for independent rejection rather than stalling silently', () => {
  const state = world(); const proposal = state.visitorBuild!.suggestions[0];
  proposal.status = 'selected'; proposal.review = { brief: 'Public page', criteria: ['Public heading'], reason: 'Useful addition' };
  state.goals.push({ id: 'goal', suggestionId: proposal.id, projectId: 'collective', status: 'active', revision: 1, revisions: [{ revision: 1, objective: 'Public page', criteria: ['Public heading'], constraints: [], createdAt: state.clock, publicBrief: { text: 'Public page', approvalId: `visitor-approval-${proposal.id}`, approvedAt: state.clock } }], completedAt: null, createdAt: state.clock, feedback: [] });
  state.tasks.push({ id: 'task', goalId: 'goal', revision: 1, entityId: 'builder-1', title: 'Private title canary', status: 'submitted', dependencies: [], attempts: 1, evidenceIds: [] });
  const context = governanceContext(state, 'moderator');
  expect(context?.action).toEqual({ type: 'suggestion.task_review', taskId: 'task', expectedRevision: 1 });
  expect(context?.content).not.toContain('canary');
  expect(context?.content).toContain('"evidence":[]');
});
