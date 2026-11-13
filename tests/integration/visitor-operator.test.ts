import { expect, it } from 'vitest';
import { createInitialState } from '../../packages/domain/src/index';
import { stagingOperatorRequest, stagingAgentCaps } from '../../tooling/staging/operator-policy';
import { visitorAgentCaps, visitorWorldCap, visitorStatus, visitorStepCandidates } from '../../tooling/staging/visitor-policy';

function world() {
  const state = createInitialState(); state.mode = 'live';
  state.visitorBuild = { visitors: [], suggestions: [{ id: 'suggestion', visitorId: 'visitor', visitorName: 'Public name', text: 'Build a useful public project page', createdAt: state.clock, status: 'selected', review: { brief: 'Build a public page', criteria: ['Shows a public heading'], reason: 'Useful public improvement' }, votes: [] }], submissions: [], observations: [], blockers: [] };
  state.goals = [{ id: 'visitor-goal', suggestionId: 'suggestion', projectId: 'collective', revision: 1, status: 'active', revisions: [{ revision: 1, objective: 'Build a public page', criteria: ['Shows a public heading'], constraints: [], createdAt: state.clock, publicBrief: { text: 'Build a public page', approvalId: 'visitor-approval-suggestion', approvedAt: state.clock } }], createdAt: state.clock, completedAt: null, feedback: [] }];

  return state;
}

it('requires specific acknowledgements and refuses caller targets, commands and cap changes', () => {
  const requests = [
    { operation: 'visitor-configure', acknowledgement: 'CONFIGURE_VISITOR_WORLD' },
    { operation: 'visitor-step', acknowledgement: 'RUN_BOUNDED_VISITOR_STEP' },
    { operation: 'visitor-status', acknowledgement: 'INSPECT_VISITOR_WORLD' },
    { operation: 'visitor-reset', acknowledgement: 'RESET_SHARED_WEBSITE' },
  ];

  for (const request of requests) {
    expect(stagingOperatorRequest.safeParse(request).success).toBe(true);
    expect(stagingOperatorRequest.safeParse({ ...request, acknowledgement: 'ENABLE_LIVE_WORLD' }).success).toBe(false);

    for (const extra of [{ entityId: 'steward' }, { count: 100 }, { dailyUsd: 100 }, { actor: 'operator' }, { command: { type: 'world.pause', paused: false } }]) expect(stagingOperatorRequest.safeParse({ ...request, ...extra }).success).toBe(false);
  }

  expect(visitorAgentCaps).toEqual({ steward: 0.75, moderator: 0.75, researcher: 0.75, 'builder-1': 0.75, 'builder-2': 0.75, 'builder-3': 0.5, 'builder-4': 0.5, archivist: 0.25 });
  expect(Object.values(visitorAgentCaps).reduce<number>((sum, amount) => sum + amount, 0)).toBe(visitorWorldCap);
  expect(stagingAgentCaps['builder-3']).toBe(0);
  expect(stagingAgentCaps['builder-1']).toBe(1.25);
});

it('selects only a ready task from the frozen public visitor goal and excludes dependency-blocked work', () => {
  const state = world();
  state.tasks = [
    { id: 'ready', goalId: 'visitor-goal', revision: 1, entityId: 'builder-1', title: 'PRIVATE-TASK-CANARY', status: 'running', dependencies: [], attempts: 1, evidenceIds: [] },
    { id: 'not-ready', goalId: 'visitor-goal', revision: 1, entityId: 'builder-2', title: 'Private next task', status: 'queued', dependencies: ['ready'], attempts: 0, evidenceIds: [] },
    { id: 'unrelated', goalId: 'private-goal', revision: 1, entityId: 'archivist', title: 'Private work', status: 'running', dependencies: [], attempts: 1, evidenceIds: [] },
  ];
  expect(visitorStepCandidates(state, 'instance')).toEqual([{ entityId: 'builder-1', lane: 'build' }]);
  state.paused = true;
  expect(() => visitorStepCandidates(state, 'instance')).toThrow('unpaused');
  state.paused = false; state.mode = 'simulation';
  expect(() => visitorStepCandidates(state, 'instance')).toThrow('live');
});

it('never falls back to personal work and rejects private operator revisions', () => {
  const state = world();
  expect(visitorStepCandidates(state, 'instance')).toEqual([]);
  state.goals[0].revision = 2;
  expect(() => visitorStepCandidates(state, 'instance')).toThrow('private or revised');
  state.goals = []; state.visitorBuild!.suggestions[0].status = 'pending';
  expect(visitorStepCandidates(state, 'instance')).toEqual([{ entityId: 'moderator', lane: 'governance' }]);
});

it('limits candidate setup to two and rotates eligible reviewers across independent instances', () => {
  const state = world(); state.goals = []; const proposal = state.visitorBuild!.suggestions[0]; proposal.status = 'reviewing';
  const selected = new Set<string>();

  for (let index = 0; index < 12; index += 1) {
    const candidates = visitorStepCandidates(state, `instance-${index}`);
    expect(candidates).toHaveLength(2);
    selected.add(candidates[0].entityId);
  }

  expect([...selected].sort()).toEqual(['moderator', 'researcher', 'steward']);
});

it('returns goal IDs and aggregate counts without source, criteria or private operational evidence', () => {
  const state = world(); state.goals[0].feedback = ['PRIVATE-FEEDBACK-CANARY'];
  state.discussions.push({ id: 'private', entityId: 'researcher', body: 'PRIVATE-DISCUSSION-CANARY', createdAt: state.clock, visibility: 'private' });
  state.tasks = [{ id: 'task', goalId: 'visitor-goal', revision: 1, entityId: 'builder-1', title: 'PRIVATE-TASK-CANARY', status: 'running', dependencies: [], attempts: 1, evidenceIds: [] }];
  const status = visitorStatus(state);
  expect(status.currentGoal).toEqual({ id: 'visitor-goal', revision: 1, status: 'active', taskCounts: { running: 1 } });
  expect(JSON.stringify(status)).not.toContain('CANARY');
  expect(JSON.stringify(status)).not.toContain('Shows a public heading');
});
