import { refreshDailyBudget } from './daily-budget';
import type { WorldState } from '../../contracts/src/index';

export type EvaluationBudgetEntry = { id: string; createdAt: string; status: 'running' | 'passed' | 'failed'; allowanceUsd: number; reservedUsd: number };

const platformEntity = 'platform-evaluation';

/** Mirrors all provider evaluation commitments without granting an entity allowance or fabricating actual costs. */
export function synchronizeEvaluationBudget(state: WorldState, evaluations: EvaluationBudgetEntry[], now: string): WorldState {
  if (!Number.isFinite(Date.parse(now))) throw new Error('Evaluation accounting requires a valid clock');
  const next = structuredClone(state);
  refreshDailyBudget(next);
  const seen = new Set<string>();
  next.clock = now;

  for (const evaluation of evaluations) {
    if (seen.has(evaluation.id)) throw new Error('Duplicate evaluation accounting entry');
    seen.add(evaluation.id);

    if (!Number.isFinite(Date.parse(evaluation.createdAt)) || !Number.isFinite(evaluation.allowanceUsd) || evaluation.allowanceUsd <= 0 || !Number.isFinite(evaluation.reservedUsd) || evaluation.reservedUsd < 0) throw new Error('Invalid evaluation accounting entry');
    const id = `platform-evaluation:${evaluation.id}`;
    const existing = next.reservations.find(item => item.id === id);

    if (existing && existing.entityId !== platformEntity) throw new Error('Evaluation reservation identity conflict');

    if (existing && existing.status !== 'reserved') {
      if (evaluation.status === 'running') throw new Error('Running evaluation commitment was already reconciled');
      continue;
    }

    const estimatedUsd = evaluation.status === 'running' ? Math.max(evaluation.allowanceUsd, evaluation.reservedUsd) : evaluation.reservedUsd;

    if (existing) {
      existing.estimatedUsd = estimatedUsd;

      if (estimatedUsd === 0) existing.status = 'released';
    } else next.reservations.push({ id, entityId: platformEntity, estimatedUsd, actualUsd: null, status: estimatedUsd > 0 ? 'reserved' : 'released', createdAt: evaluation.createdAt });
  }

  refreshDailyBudget(next);

  return next;
}

/** Evaluation enablement is separate from activation, but never creates an additional spending pool. */
export function assertEvaluationWorldAllowance(state: WorldState, additionalUsd: number): void {
  if (!Number.isFinite(additionalUsd) || additionalUsd <= 0) throw new Error('Evaluation reservation must be finite and positive');

  if (!Number.isFinite(state.budget.dailyUsd) || state.budget.dailyUsd <= 0 || state.budget.spentUsd + state.budget.reservedUsd + additionalUsd > state.budget.dailyUsd) throw new Error('World allowance exhausted; evaluation not dispatched');
}
