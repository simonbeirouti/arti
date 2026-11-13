import type { Entity, WorldState } from '../../../../../packages/contracts/src/index';
import { districts } from './map-layout';

const labels = { idle: 'At workstation', working: 'Building', discussing: 'In conversation', researching: 'Researching', reviewing: 'Reviewing', publishing: 'Publishing', exploring: 'Exploring' };

const squareSlots = [[43, 55], [56, 55], [32, 69], [56, 76], [65, 60], [35, 37]];

/** Coordinates are a view of persisted presence, never a source of world authority. */
export function mapActivity(entity: Entity, population: Entity[]) {
  const presence = entity.presence;
  const locationId = presence?.locationId ?? entity.id;
  const home = districts.find(place => place.id === entity.id) ?? districts[0];
  const destination = districts.find(place => place.id === locationId) ?? home;
  const index = Math.max(0, population.findIndex(item => item.id === entity.id));
  const gatheringIndex = Math.max(0, population.filter(item => item.presence?.locationId === 'square').findIndex(item => item.id === entity.id));
  const square = squareSlots[gatheringIndex % squareSlots.length];
  const visiting = destination.id !== entity.id;
  const left = locationId === 'square' ? square[0] : parseFloat(destination.left) + (visiting ? ((index % 3) - 1) * 5 : 0);
  const top = locationId === 'square' ? square[1] : parseFloat(destination.top) + (visiting ? 8 + Math.floor(index / 3) * 5 : 0);

  const peers = (presence?.peers ?? []).flatMap(id => {
    const peer = population.find(item => item.id === id && item.id !== entity.id);

    return peer ? [peer.name] : [];
  });

  return { position: { left: `${left}%`, top: `${top}%` }, label: labels[presence?.activity ?? 'idle'], summary: presence?.summary ?? 'Awaiting the next world event', locationName: locationId === 'square' ? 'Town square' : destination.name, peers };
}

export function currentAssignment(entityId: string, state: WorldState | null) {
  if (!state) return undefined;
  const currentGoals = state.goals.filter(goal => !['completed', 'cancelled'].includes(goal.status));
  const tasks = state.tasks.filter(task => task.entityId === entityId && currentGoals.some(goal => goal.id === task.goalId && goal.revision === task.revision) && ['running', 'submitted', 'queued', 'blocked'].includes(task.status));

  return tasks.find(task => task.status === 'running') ?? tasks.find(task => task.status === 'submitted') ?? tasks[0];
}
