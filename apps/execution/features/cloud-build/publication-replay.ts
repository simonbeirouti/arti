import type { Deployment, WorldState } from '../../../../packages/contracts/src/index';
import type { BuildRequest } from './build-request';

export function matchingPublication(state: WorldState, request: BuildRequest, id: string, hash?: string): Deployment | null {
  const saved = state.deployments.find(deployment => deployment.id === id);

  if (!saved) return null;

  if (saved.projectId !== request.projectId || saved.entityId !== request.entityId || saved.commit !== request.commit || saved.taskId !== request.taskId || saved.goalId !== request.goalId || saved.revision !== request.revision || saved.environment !== 'production' || saved.status !== 'published' || !/^[a-f0-9]{64}$/.test(saved.bundleHash) || saved.workerName !== `${(request.projectId ?? request.entityId).slice(0, 15)}-${saved.bundleHash}` || (hash !== undefined && hash !== saved.bundleHash)) throw new Error('Saved publication receipt conflicts with pinned build');

  return saved;
}

export async function publishOrReplay(state: WorldState, request: BuildRequest, id: string, hash: string, publish: () => Promise<Deployment>, recoverEvidence: (deployment: Deployment) => Promise<void>): Promise<Deployment> {
  const saved = matchingPublication(state, request, id, hash);

  if (saved) { await recoverEvidence(saved);

    return saved; }

  return publish();
}

export function needsBuildEvidenceRecovery(state: WorldState, request: BuildRequest, evidenceId: string): boolean {
  const task = state.tasks.find(item => item.id === request.taskId && item.entityId === request.entityId);
  const goal = state.goals.find(item => item.id === request.goalId);

  return Boolean(request.goalId && state.mode === 'live' && !state.paused && task && goal && goal.status === 'active' && goal.revision === request.revision && task.revision === request.revision && ['queued', 'running'].includes(task.status) && !state.evidence.some(item => item.id === evidenceId));
}
