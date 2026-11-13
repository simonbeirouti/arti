import { expect, it } from 'vitest';
import { createInitialState } from '../../../../packages/domain/src/index';
import { codeScope } from './code-scope';

it('permits stable personal repository scopes only between shared goals', () => {
  const state = createInitialState();
  state.projects = [];
  expect(codeScope(state, 'builder-1', 'personal-presence')).toEqual({ repoName: 'builder-1-personal-presence', taskId: 'personal-presence' });
  state.goals.push({ id: 'goal', status: 'paused', revision: 1, revisions: [], createdAt: state.clock, completedAt: null, feedback: [] });
  expect(() => codeScope(state, 'builder-1', 'personal-presence')).toThrow('shared goals');
  state.goals[0].status = 'completed';
  expect(codeScope(state, 'builder-1', 'personal-presence').goalId).toBeUndefined();
});

it('rejects foreign assignments and unmet dependencies', () => {
  const state = createInitialState();
  state.goals.push({ id: 'goal', status: 'active', revision: 1, revisions: [], createdAt: state.clock, completedAt: null, feedback: [] });
  state.tasks.push({ id: 'build', entityId: 'builder-1', goalId: 'goal', revision: 1, title: 'Build', dependencies: ['research'], status: 'queued', attempts: 0, evidenceIds: [] });
  expect(() => codeScope(state, 'builder-2', 'build')).toThrow('assigned');
  expect(() => codeScope(state, 'builder-1', 'build')).toThrow('dependencies');
  state.tasks.push({ id: 'research', entityId: 'researcher', goalId: 'goal', revision: 1, title: 'Research', dependencies: [], status: 'verified', attempts: 1, evidenceIds: [] });
  expect(codeScope(state, 'builder-1', 'build').revision).toBe(1);
});
