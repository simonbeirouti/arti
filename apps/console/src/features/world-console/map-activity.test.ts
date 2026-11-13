import { expect, it } from 'vitest';
import { WorldEngine } from '../../../../../packages/domain/src/index';
import { currentAssignment, mapActivity } from './map-activity';

it('projects persisted visits and social peers into distinct map destinations', () => {
  const population = new WorldEngine().getState().entities;
  const first = population[0];
  const second = population[1];
  const home = mapActivity(first, population);
  first.presence = { locationId: 'square', activity: 'discussing', peers: [second.id], summary: 'Exchanging public ideas', updatedAt: '2026-10-12T01:00:00.000Z' };
  second.presence = { ...first.presence, peers: [first.id] };
  const visit = mapActivity(first, population);
  expect(visit.position).not.toEqual(home.position);
  expect(visit.position).not.toEqual(mapActivity(second, population).position);
  expect(visit.peers).toEqual([second.name]);
  expect(visit.label).toBe('In conversation');
  expect(visit.locationName).toBe('Town square');
});

it('selects only a current-revision private assignment and has no assignment on the public map', () => {
  const engine = new WorldEngine();
  const state = engine.dispatch({ role: 'operator' }, { type: 'goal.create', objective: 'PRIVATE knowledge goal', criteria: ['Useful guide'], constraints: [] }, 'map-create');
  const goalId = state.goals[0].id;
  engine.dispatch({ role: 'operator' }, { type: 'goal.start', goalId }, 'map-start');
  const current = engine.getState();
  const assigned = current.tasks[0];
  expect(currentAssignment(assigned.entityId, current)?.id).toBe(assigned.id);
  const goal = current.goals[0];
  goal.revision++;
  expect(currentAssignment(assigned.entityId, current)).toBeUndefined();
  expect(currentAssignment(assigned.entityId, null)).toBeUndefined();
});
