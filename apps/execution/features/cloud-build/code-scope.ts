import { approvedAuthoringScope } from './authoring-scope';
import type { WorldState } from '../../../../packages/contracts/src/index';

export type CodeScope = { repoName: string; taskId: string; goalId?: string; revision?: number; projectId?: string; canonicalRepoName?: string };

export function codeScope(state: WorldState, entityId: string, taskId: string): CodeScope {
  const task = state.tasks.find(task => task.id === taskId && task.entityId === entityId);

  if (task) {
    const goal = state.goals.find(goal => goal.id === task.goalId);

    if (!goal || goal.status !== 'active' || goal.revision !== task.revision || !['queued', 'running'].includes(task.status) || !task.dependencies.every(id => state.tasks.some(dependency => dependency.id === id && dependency.status === 'verified'))) throw new Error('Task is not current or dependencies are incomplete');

    if (task.projectId !== goal.projectId) throw new Error('Task project differs from goal');

    if (state.mode === 'live') approvedAuthoringScope(state, entityId, taskId);

    if (task.projectId) {
      const project = state.projects?.find(project => project.id === task.projectId);

      if (!project || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(project.repository)) throw new Error('Assigned project is not registered');

      return { repoName: `${project.repository}-${entityId}-${task.id}`, canonicalRepoName: project.repository, projectId: project.id, taskId: task.id, goalId: goal.id, revision: goal.revision };
    }

    return { repoName: `${entityId}-${task.id}`, taskId: task.id, goalId: goal.id, revision: goal.revision };
  }

  if (state.projects?.length) throw new Error('Personal website code work is retired; use an assigned shared-project task');

  if (!/^personal-[a-z0-9][a-z0-9_-]{0,79}$/.test(taskId)) throw new Error('Only assigned tasks or personal projects may use code tools');

  if (state.goals.some(goal => !['completed', 'cancelled'].includes(goal.status))) throw new Error('Personal code work waits for shared goals to close');

  return { repoName: `${entityId}-${taskId}`, taskId };
}
