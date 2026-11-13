import { publicAuthoringScopeSchema, type PublicAuthoringScope, type WorldState } from '../../../../packages/contracts/src/index';

/** Approval scope comes from the isolated runtime, never from model tool arguments. */
export function approvedAuthoringScope(state: WorldState, entityId: string, taskId: string): PublicAuthoringScope {
  const task = state.tasks.find(item => item.id === taskId && item.entityId === entityId);
  const goal = state.goals.find(item => item.id === task?.goalId);
  const revision = goal?.revisions.find(item => item.revision === goal.revision);

  if (!task || !goal || goal.status !== 'active' || goal.revision !== task.revision || !['queued', 'running'].includes(task.status) || !task.dependencies.every(id => state.tasks.some(dependency => dependency.id === id && dependency.status === 'verified'))) throw new Error('Public authoring requires a current ready own task');

  if (task.projectId !== goal.projectId) throw new Error('Task project differs from goal');

  if (!revision?.publicBrief) throw new Error('Current revision needs an operator-approved public authoring brief');

  const scope: PublicAuthoringScope = { goalId: goal.id, revision: goal.revision, taskId: task.id, approvalId: revision.publicBrief.approvalId };

  if (task.projectId) scope.projectId = task.projectId;

  return scope;
}

export function validateAuthoringScope(state: WorldState, entityId: string, supplied?: PublicAuthoringScope, taskId?: string): PublicAuthoringScope | undefined {
  const unfinished = state.goals.some(goal => !['completed', 'cancelled'].includes(goal.status));

  if (!unfinished) {
    if (supplied) throw new Error('Public authoring scope is no longer active');

    return undefined;
  }

  if (!supplied) throw new Error('An isolated public authoring scope is required');
  const parsed = publicAuthoringScopeSchema.parse(supplied);
  const expected = approvedAuthoringScope(state, entityId, parsed.taskId);

  if (taskId && taskId !== parsed.taskId) throw new Error('Tool task differs from trusted authoring task');

  if (parsed.goalId !== expected.goalId || parsed.revision !== expected.revision || parsed.approvalId !== expected.approvalId || parsed.projectId !== expected.projectId) throw new Error('Public authoring approval superseded');

  return expected;
}

export function executionAuthoringScope(state: WorldState, entityId: string, tool: string, supplied?: PublicAuthoringScope): PublicAuthoringScope | undefined {
  if (['data.get', 'data.put', 'data.delete'].includes(tool) && (supplied || state.goals.some(goal => !['completed', 'cancelled'].includes(goal.status)))) throw new Error('Application data tools are disabled during shared-goal authoring');
  const publicMutation = ['repo.fork', 'repo.patch_commit', 'execution.request_build', 'data.put', 'data.delete', 'research.retrieve', 'research.browser'].includes(tool);

  if (publicMutation || supplied) return validateAuthoringScope(state, entityId, supplied);

  return undefined;
}
