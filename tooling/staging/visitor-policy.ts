import type { WorldState } from '../../packages/contracts/src/index';
import { governanceContext } from '../../apps/world/features/visitor-governance/governance';
import { publicVisitorGoal } from '../../apps/world/features/visitor-governance/observation';

export const visitorAgentCaps = { steward: 0.75, moderator: 0.75, researcher: 0.75, 'builder-1': 0.75, 'builder-2': 0.75, 'builder-3': 0.5, 'builder-4': 0.5, archivist: 0.25 } as const;

export const visitorWorldCap = 5;

export type VisitorStep = { entityId: string; lane: 'governance' | 'build' };

/** Authenticated setup can accelerate only public visitor work, never personal or private goals. */
export function visitorStepCandidates(state: WorldState, instanceId: string): VisitorStep[] {
  if (state.mode !== 'live' || state.paused) throw new Error('Visitor step requires an unpaused live world');
  const unfinished = state.goals.filter(goal => !['completed', 'cancelled'].includes(goal.status));

  if (unfinished.some(goal => !publicVisitorGoal(state, goal))) throw new Error('Visitor step cannot run private or revised goals');
  const governance: VisitorStep[] = ['moderator', 'researcher', 'steward'].flatMap(entityId => governanceContext(state, entityId) ? [{ entityId, lane: 'governance' }] : []);
  const goal = unfinished.find(item => item.status === 'active');
  const build: VisitorStep[] = state.tasks.flatMap(task => task.goalId === goal?.id && task.revision === goal?.revision && ['queued', 'running'].includes(task.status) && task.dependencies.every(id => state.tasks.some(dependency => dependency.id === id && dependency.goalId === goal.id && dependency.revision === goal.revision && dependency.status === 'verified')) ? [{ entityId: task.entityId, lane: 'build' }] : []);
  const candidates = [...governance, ...build];

  if (!candidates.length) return [];
  let offset = state.receipts.length;

  for (const character of instanceId) offset = (offset * 31 + character.charCodeAt(0)) >>> 0;
  offset %= candidates.length;

  return Array.from({ length: Math.min(2, candidates.length) }, (_, index) => candidates[(offset + index) % candidates.length]);
}

/** Return identifiers and counts only; private titles, evidence assertions and source are omitted. */
export function visitorStatus(state: WorldState) {
  const goal = state.goals.find(item => item.suggestionId && !['completed', 'cancelled'].includes(item.status)) ?? state.goals.findLast(item => item.suggestionId);
  const tasks = state.tasks.filter(task => task.goalId === goal?.id && task.revision === goal?.revision);
  const taskCounts: Record<string, number> = {};
  const suggestionCounts: Record<string, number> = {};

  for (const task of tasks) taskCounts[task.status] = (taskCounts[task.status] ?? 0) + 1;

  for (const proposal of state.visitorBuild?.suggestions ?? []) suggestionCounts[proposal.status] = (suggestionCounts[proposal.status] ?? 0) + 1;

  return { mode: state.mode, paused: state.paused, currentGoal: goal ? { id: goal.id, revision: goal.revision, status: goal.status, taskCounts } : null, suggestionCounts, evidenceCount: state.evidence.filter(item => item.goalId === goal?.id && item.revision === goal?.revision && item.status === 'verified').length, deploymentCount: state.deployments.filter(item => item.goalId === goal?.id && item.revision === goal?.revision && item.status === 'published').length, worldAllowanceUsd: state.budget.dailyUsd, entityAllowances: state.entities.map(item => ({ id: item.id, dailyAllowanceUsd: item.dailyAllowanceUsd })) };
}
