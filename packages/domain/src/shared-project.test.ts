import { expect, it } from 'vitest';
import { createInitialState, WorldEngine, parseWorldState } from './index';

it('migrates six retained agents without resetting identities, history or spending', () => {
  const legacy = createInitialState(); legacy.entities = legacy.entities.filter(entity => !['builder-3', 'builder-4'].includes(entity.id)); delete legacy.projects;
  legacy.entities[0].name = 'Retained name'; legacy.budget.spentUsd = 0.4;
  const migrated = new WorldEngine(legacy).getState();
  expect(migrated.entities).toHaveLength(8); expect(migrated.entities[0].name).toBe('Retained name'); expect(migrated.budget.spentUsd).toBe(0.4);
  expect(migrated.projects?.[0].repository).toBe('collective');
  expect(migrated.entities.filter(entity => entity.role === 'builder')).toHaveLength(4);
});

it('persists shared scope and provenance while public projection excludes private goal metadata', () => {
  const engine = new WorldEngine();
  const state = engine.dispatch({ role: 'operator' }, { type: 'goal.create', objective: 'PRIVATE collective objective', criteria: ['Check saved output'], constraints: [] }, 'shared-goal-draft');
  engine.dispatch({ role: 'operator' }, { type: 'goal.start', goalId: state.goals[0].id }, 'shared-goal-start');
  const saved = parseWorldState(JSON.stringify(engine.getState()));
  expect(saved.tasks).toHaveLength(8); expect(saved.tasks.every(task => task.projectId === 'collective')).toBe(true);
  expect(saved.projects?.[0].id).toBe('collective');
  expect(JSON.stringify(engine.getPublicState())).not.toContain('PRIVATE collective objective');
});
