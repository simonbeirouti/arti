import { describe, expect, it } from 'vitest';
import { createInitialState, WorldEngine } from './index';
import { assertEvaluationWorldAllowance, synchronizeEvaluationBudget, type EvaluationBudgetEntry } from './evaluation-budget';

const now = '2026-10-12T10:00:00.000Z';

function run(id: string, reservedUsd: number, status: EvaluationBudgetEntry['status'] = 'running'): EvaluationBudgetEntry {
  return { id, status, reservedUsd, allowanceUsd: 0.1, createdAt: now };
}

function fundedWorld() {
  const state = createInitialState();
  state.mode = 'live';
  state.clock = now;
  state.paused = true;
  state.budget.dailyUsd = 5;
  const researcher = state.entities.find(entity => entity.id === 'researcher');

  if (!researcher) throw new Error('Missing entity');
  researcher.dailyAllowanceUsd = 1;

  return state;
}

describe('world-wide evaluation accounting', () => {
  it('shares the global cap with agent commitments without changing entity caps or duplicating replay', () => {
    const state = fundedWorld();
    state.reservations.push({ id: 'agent-running', entityId: 'researcher', estimatedUsd: 0.4, actualUsd: null, status: 'reserved', createdAt: now });
    state.budget.reservedUsd = 0.4;
    state.budget.spentUsd = 0.6;
    const evaluations = [run('running', 0.03), run('finished', 0.07, 'passed')];
    const accounted = synchronizeEvaluationBudget(state, evaluations, now);
    expect(accounted.budget.reservedUsd).toBeCloseTo(0.57);
    expect(accounted.budget.spentUsd).toBe(0.6);
    expect(accounted.entities).toEqual(state.entities);
    expect(state.reservations).toHaveLength(1);
    expect(synchronizeEvaluationBudget(accounted, evaluations, now)).toEqual(accounted);
    expect(() => assertEvaluationWorldAllowance(accounted, 3.8)).not.toThrow();
    expect(() => assertEvaluationWorldAllowance(accounted, 3.9)).toThrow('World allowance exhausted');
  });

  it('releases unused maximum allowance on finish while retaining dispatched estimates across rollover', () => {
    const state = synchronizeEvaluationBudget(fundedWorld(), [run('one', 0.1)], now);
    const finished = synchronizeEvaluationBudget(state, [run('one', 0.06, 'failed')], now);
    expect(finished.budget.reservedUsd).toBeCloseTo(0.06);
    expect(finished.reservations[0]).toMatchObject({ id: 'platform-evaluation:one', status: 'reserved', actualUsd: null, estimatedUsd: 0.06 });
    const nextDay = synchronizeEvaluationBudget(finished, [run('one', 0.06, 'failed')], '2026-10-13T00:00:00.000Z');
    expect(nextDay.budget.reservedUsd).toBe(0);
    expect(nextDay.budget.outstandingReservedUsd).toBeCloseTo(0.06);
    expect(nextDay.reservations).toEqual(finished.reservations);
    expect(nextDay.budget.spentUsd).toBe(0);
  });

  it('preserves independently reconciled actual costs without reserving finished evaluations again', () => {
    const state = synchronizeEvaluationBudget(fundedWorld(), [run('one', 0.06, 'passed')], now);
    const engine = new WorldEngine(state);
    engine.settleBudget('platform-evaluation:one', 0.02);
    const reconciled = synchronizeEvaluationBudget(engine.getState(), [run('one', 0.06, 'passed')], now);
    expect(reconciled.budget.reservedUsd).toBe(0);
    expect(reconciled.budget.spentUsd).toBe(0.02);
    expect(reconciled.reservations[0]).toMatchObject({ status: 'settled', actualUsd: 0.02 });
    expect(() => synchronizeEvaluationBudget(reconciled, [run('one', 0.06)], now)).toThrow('already reconciled');
  });

  it('imports every legacy run beyond display limits conservatively, including an existing cap overrun', () => {
    const evaluations = Array.from({ length: 60 }, (_unused, index) => run(`legacy-${index}`, 0.1, 'failed'));
    const accounted = synchronizeEvaluationBudget(fundedWorld(), evaluations, now);
    expect(accounted.reservations).toHaveLength(60);
    expect(accounted.budget.reservedUsd).toBeCloseTo(6);
    expect(() => assertEvaluationWorldAllowance(accounted, 0.1)).toThrow('World allowance exhausted');
    expect(synchronizeEvaluationBudget(accounted, evaluations, now).reservations).toHaveLength(60);
  });

  it('fails closed on reservation identity conflicts and retains unrelated conservative aggregate commitments', () => {
    const state = fundedWorld();
    state.budget.reservedUsd = 0.3;
    expect(synchronizeEvaluationBudget(state, [run('one', 0.1)], now).budget.reservedUsd).toBeCloseTo(0.4);
    state.reservations.push({ id: 'platform-evaluation:one', entityId: 'researcher', estimatedUsd: 0.1, actualUsd: null, status: 'reserved', createdAt: now });
    expect(() => synchronizeEvaluationBudget(state, [run('one', 0.1)], now)).toThrow('identity conflict');
    expect(() => assertEvaluationWorldAllowance(fundedWorld(), 0)).toThrow('finite and positive');
  });
});
