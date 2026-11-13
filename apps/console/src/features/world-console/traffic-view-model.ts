import type { PublicWorld, WorldState } from '../../../../../packages/contracts/src/index';
import { visibleDiscussions } from './discussion-provenance';

export type TrafficEdge = { id: string; from: string; to: string; status: 'queued' | 'active' | 'completed'; kind: 'work' | 'reply' | 'handoff'; observedAt: string };

/** Public traffic is derived exclusively from public records, even if private state is supplied. */
export function observedTraffic(data: PublicWorld | WorldState, isPublic: boolean): TrafficEdge[] {
  const edges: TrafficEdge[] = [];
  const known = new Set(data.entities.map(entity => entity.id));

  for (const entity of data.entities) {
    const presence = entity.presence;

    if (!presence || entity.status !== 'working') continue;

    if (presence.activity === 'working' || presence.activity === 'publishing' || presence.activity === 'reviewing') {
      edges.push({ id: `work-${entity.id}`, from: entity.id, to: 'collective', status: 'active', kind: 'work', observedAt: presence.updatedAt });
    }

    if (presence.activity === 'discussing') {
      for (const peer of presence.peers.filter(id => known.has(id) && id !== entity.id)) {
        edges.push({ id: `peer-${entity.id}-${peer}`, from: entity.id, to: peer, status: 'active', kind: 'work', observedAt: presence.updatedAt });
      }
    }
  }

  const messages = visibleDiscussions(data.discussions, data.mode).filter(item => item.visibility === 'public');
  const messageById = new Map(messages.map(item => [item.id, item]));

  for (const message of messages.slice(-12)) {
    const parent = message.replyTo ? messageById.get(message.replyTo) : undefined;

    if (parent && parent.entityId !== message.entityId && known.has(parent.entityId) && known.has(message.entityId)) {
      edges.push({ id: `reply-${message.id}`, from: parent.entityId, to: message.entityId, status: 'completed', kind: 'reply', observedAt: message.createdAt });
    }
  }

  if (!isPublic && 'tasks' in data) {
    const current = data.tasks.filter(task => data.goals.some(goal => goal.id === task.goalId && goal.revision === task.revision && !['cancelled', 'completed'].includes(goal.status)));
    const taskById = new Map(current.map(task => [task.id, task]));

    for (const [index, task] of current.entries()) {
      if (!['queued', 'running', 'submitted', 'verified'].includes(task.status)) continue;

      for (const [dependencyIndex, dependencyId] of task.dependencies.entries()) {
        const prerequisite = taskById.get(dependencyId);

        if (prerequisite && prerequisite.entityId !== task.entityId) {
          edges.push({ id: `handoff-${index}-${dependencyIndex}`, from: prerequisite.entityId, to: task.entityId, status: task.status === 'verified' ? 'completed' : task.status === 'running' && data.entities.some(entity => entity.id === task.entityId && entity.status === 'working') ? 'active' : 'queued', kind: 'handoff', observedAt: data.clock });
        }
      }
    }
  }

  return edges;
}
