import { frozenVisitorGoal } from '../../../../packages/domain/src/shared-reset';
import type { Deployment, Discussion, EvidenceRun, Goal, Task, WorldState, PublicAuthoringScope } from '../../../../packages/contracts/src/index';

export type PublicAssignment = { scope: PublicAuthoringScope; brief: string; taskTitle: string; taskStatus: 'queued' | 'running' };

const publicResponsibilities = new Map(Object.entries({ researcher: 'Research public sources and provenance', 'builder-1': 'Build a useful public service', 'builder-2': 'Build a useful public interface', 'builder-3': 'Build the shared application workflow', 'builder-4': 'Integrate and test the shared application', moderator: 'Check public outcomes', archivist: 'Publish a verified public guide', steward: 'Assemble public completion references' }));

/** Only the explicitly approved brief and platform-owned metadata cross this boundary. */
export function publicAssignment(state: WorldState, entityId: string): PublicAssignment | null {
  if (state.paused || !state.entities.some(entity => entity.id === entityId)) return null;
  const task = state.tasks.find(item => item.entityId === entityId && ['queued', 'running'].includes(item.status) && state.goals.some(goal => goal.id === item.goalId && goal.status === 'active' && goal.revision === item.revision && (!state.visitorBuild?.sharedOnly || frozenVisitorGoal(state, goal))) && item.dependencies.every(id => state.tasks.some(dependency => dependency.id === id && dependency.goalId === item.goalId && dependency.revision === item.revision && dependency.status === 'verified')));

  if (!task || (task.status !== 'queued' && task.status !== 'running')) return null;
  const goal = state.goals.find(item => item.id === task.goalId);

  if (task.projectId !== goal?.projectId || task.projectId && !state.projects?.some(project => project.id === task.projectId)) return null;
  const brief = goal?.revisions.find(item => item.revision === task.revision)?.publicBrief;

  if (!brief) return null;

  return { scope: { projectId: task.projectId, goalId: task.goalId, revision: task.revision, taskId: task.id, approvalId: brief.approvalId }, brief: brief.text, taskTitle: publicResponsibilities.get(entityId) ?? 'Create the approved public deliverable', taskStatus: task.status };
}

export function authorizePublicAssignment(state: WorldState, entityId: string, scope: PublicAuthoringScope): void {
  const current = publicAssignment(state, entityId);

  if (!current || current.scope.goalId !== scope.goalId || current.scope.revision !== scope.revision || current.scope.taskId !== scope.taskId || current.scope.approvalId !== scope.approvalId || current.scope.projectId !== scope.projectId) throw new Error('Public authoring scope is no longer authorized');
}

export type DependencyHandoff = {
  task: Task;
  submissions: Pick<Discussion, 'id' | 'body' | 'createdAt'>[];
  evidence: EvidenceRun[];
  deployments: Deployment[];
};

export type PrivateAssignment = {
  task: Task;
  goal: Goal;
  confirmations: WorldState['confirmations'];
  dependencyHandoffs: DependencyHandoff[];
};

/** Internal runtime lookup: identity comes from the authenticated entity binding, never model arguments. */
export function privateAssignment(state: WorldState, entityId: string): PrivateAssignment | null {
  if (state.visitorBuild?.sharedOnly) return null;

  if (!state.entities.some(entity => entity.id === entityId)) return null;
  const task = state.tasks.find(item => item.entityId === entityId && ['queued', 'running'].includes(item.status) && state.goals.some(goal => goal.id === item.goalId && goal.status === 'active' && goal.revision === item.revision) && item.dependencies.every(id => state.tasks.some(dependency => dependency.id === id && dependency.goalId === item.goalId && dependency.revision === item.revision && dependency.status === 'verified')));

  if (!task) return null;
  const goal = state.goals.find(item => item.id === task.goalId);

  if (!goal) return null;
  const dependencyHandoffs: DependencyHandoff[] = [];

  for (const dependencyId of task.dependencies) {
    const dependency = state.tasks.find(item => item.id === dependencyId && item.goalId === goal.id && item.revision === goal.revision && item.status === 'verified');

    if (!dependency) continue;
    const submissions = state.discussions.flatMap(item => item.visibility === 'private' && item.goalId === goal.id && item.taskId === dependency.id && item.revision === goal.revision && item.entityId === dependency.entityId ? [{ id: item.id, body: item.body, createdAt: item.createdAt }] : []);
    const evidence = state.evidence.filter(item => item.taskId === dependency.id && item.goalId === goal.id && item.revision === goal.revision && item.entityId === dependency.entityId && item.status === 'verified' && dependency.evidenceIds.includes(item.id));
    const deployments = state.deployments.filter(item => item.goalId === goal.id && item.revision === goal.revision && item.entityId === dependency.entityId && item.status === 'published' && (item.taskId === dependency.id || evidence.some(run => run.deploymentId === item.id)));
    dependencyHandoffs.push({ task: dependency, submissions, evidence, deployments });
  }

  return { task, goal, confirmations: state.confirmations.filter(item => item.taskId === task.id && item.goalId === goal.id && item.revision === goal.revision), dependencyHandoffs };
}
