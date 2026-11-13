import { expect, it } from 'vitest';
import { createInitialState } from '../../../../packages/domain/src/index';
import { approvedAuthoringScope, executionAuthoringScope, validateAuthoringScope } from './authoring-scope';
import { codeScope } from './code-scope';
import { buildRequestSchema } from './build-request';

function fixture() {
  const state = createInitialState();
  state.mode = 'live';
  state.goals.push({ id: 'shared', status: 'active', revision: 1, revisions: [{ revision: 1, objective: 'PRIVATE_OBJECTIVE', criteria: ['PRIVATE_CRITERION'], constraints: [], createdAt: state.clock }], createdAt: state.clock, completedAt: null, feedback: [] });
  state.tasks.push({ id: 'build', entityId: 'builder-1', goalId: 'shared', revision: 1, title: 'PRIVATE_TASK', dependencies: [], status: 'queued', attempts: 0, evidenceIds: [] });

  return state;
}

it('requires a current approved brief for live code scopes and never returns private goal text', () => {
  const state = fixture();
  expect(() => codeScope(state, 'builder-1', 'build')).toThrow('approved');
  expect(() => approvedAuthoringScope(state, 'builder-1', 'build')).toThrow('approved');
  state.goals[0].revisions[0].publicBrief = { text: 'Build a public guide', approvalId: 'approval-1', approvedAt: state.clock };
  const scope = approvedAuthoringScope(state, 'builder-1', 'build');
  expect(scope).toEqual({ goalId: 'shared', taskId: 'build', revision: 1, approvalId: 'approval-1' });
  expect(JSON.stringify(scope)).not.toContain('PRIVATE');
  expect(codeScope(state, 'builder-1', 'build').goalId).toBe('shared');
  expect(() => validateAuthoringScope(state, 'builder-1')).toThrow('required');
  expect(() => validateAuthoringScope(state, 'builder-2', scope)).toThrow('own task');
  expect(() => validateAuthoringScope(state, 'builder-1', scope, 'another-task')).toThrow('differs');
  expect(validateAuthoringScope(state, 'builder-1', scope)).toEqual(scope);
});

it('rejects superseded approvals, changed goal revisions, paused goals and unfinished personal publication', () => {
  const state = fixture();
  state.goals[0].revisions[0].publicBrief = { text: 'Public brief', approvalId: 'approval-1', approvedAt: state.clock };
  const scope = approvedAuthoringScope(state, 'builder-1', 'build');
  state.goals[0].revisions[0].publicBrief.approvalId = 'approval-2';
  expect(() => validateAuthoringScope(state, 'builder-1', scope)).toThrow('superseded');
  state.goals[0].revision = 2;
  expect(() => validateAuthoringScope(state, 'builder-1', scope)).toThrow('current');
  state.goals[0].revision = 1;
  state.goals[0].status = 'paused';
  expect(() => validateAuthoringScope(state, 'builder-1', scope)).toThrow('current');
  expect(() => validateAuthoringScope(state, 'builder-1')).toThrow('required');
  state.goals[0].status = 'completed';
  expect(validateAuthoringScope(state, 'builder-1')).toBeUndefined();
  expect(() => validateAuthoringScope(state, 'builder-1', scope)).toThrow('no longer');
});

it('requires consistent scope on shared-goal builds and rejects model-selected scope fields', () => {
  const base = { entityId: 'builder-1', repoName: 'builder-1-build', commit: 'a'.repeat(40), taskId: 'build', goalId: 'shared', revision: 1 };
  expect(buildRequestSchema.safeParse(base).success).toBe(false);
  const authoringScope = { goalId: 'shared', revision: 1, taskId: 'build', approvalId: 'approval-1' };
  expect(buildRequestSchema.safeParse({ ...base, authoringScope }).success).toBe(true);
  expect(buildRequestSchema.safeParse({ ...base, authoringScope: { ...authoringScope, taskId: 'foreign-task' } }).success).toBe(false);
  expect(buildRequestSchema.safeParse({ ...base, authoringScope: { ...authoringScope, actorId: 'operator' } }).success).toBe(false);
  expect(buildRequestSchema.safeParse({ entityId: 'builder-1', repoName: 'builder-1', commit: base.commit, taskId: 'personal-starter' }).success).toBe(true);
});

it('separates private permitted reads from scoped public mutations and research', () => {
  const state = fixture();
  state.goals[0].revisions[0].publicBrief = { text: 'Only this approved public content', approvalId: 'approval-1', approvedAt: state.clock };
  const scope = approvedAuthoringScope(state, 'builder-1', 'build');

  for (const tool of ['data.get', 'data.put', 'data.delete']) {
    expect(() => executionAuthoringScope(state, 'builder-1', tool)).toThrow('disabled');
    expect(() => executionAuthoringScope(state, 'builder-1', tool, scope)).toThrow('disabled');
  }

  for (const tool of ['repo.fork', 'repo.patch_commit', 'execution.request_build', 'research.retrieve', 'research.browser']) {
    expect(() => executionAuthoringScope(state, 'builder-1', tool)).toThrow('required');
    expect(executionAuthoringScope(state, 'builder-1', tool, scope)).toEqual(scope);
  }

  state.goals[0].status = 'completed';
  expect(executionAuthoringScope(state, 'builder-1', 'repo.fork')).toBeUndefined();
  expect(executionAuthoringScope(state, 'builder-1', 'data.get')).toBeUndefined();
  expect(executionAuthoringScope(state, 'builder-1', 'data.put')).toBeUndefined();
});
