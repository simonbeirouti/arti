import { expect, it } from 'vitest';
import { createInitialState, parseWorldState, WorldEngine } from './index';
import { entityDailyCommitment, refreshDailyBudget, restoreDailyAccounting } from './daily-budget';

const dayOne = '2026-10-12T23:00:00.000Z';

const dayTwo = '2026-10-13T01:00:00.000Z';

function funded() {
  const state = createInitialState(); state.mode = 'live'; state.clock = dayOne;
  state.budget.dailyUsd = 5;

  for (const entity of state.entities) entity.dailyAllowanceUsd = 0.75;

  return new WorldEngine(state);
}

it('retains old unknown liabilities without consuming a new daily allowance or exceeding same-day caps', () => {
  const engine = funded(); engine.reserveBudget('builder-1', 0.75, 'yesterday-builder'); engine.reserveBudget('researcher', 0.75, 'yesterday-research');
  const yesterday = engine.getState(); const next = structuredClone(yesterday); next.clock = dayTwo;
  const today = new WorldEngine(next);
  expect(today.getState().budget).toMatchObject({ reservedUsd: 0, spentUsd: 0, outstandingReservedUsd: 1.5 });
  expect(today.getState().reservations).toEqual(yesterday.reservations);
  today.dispatch({ role: 'operator' }, { type: 'budget.entity.configure', entityId: 'builder-1', dailyUsd: 0.5 }, 'set-today-cap');
  today.reserveBudget('builder-1', 0.5, 'today-builder');
  expect(() => today.reserveBudget('builder-1', 0.01, 'today-over-cap')).toThrow('cap exhausted');
  expect(today.getState().budget).toMatchObject({ reservedUsd: 0.5, outstandingReservedUsd: 2 });
  expect(() => today.reserveBudget('builder-1', 0.75, 'yesterday-builder')).toThrow('Prior-day');
});

it('attributes late measured settlements to original dispatch day and preserves original receipts', () => {
  const engine = funded(); engine.reserveBudget('researcher', 0.5, 'late-usage');
  const state = engine.getState(); state.clock = dayTwo;
  const today = new WorldEngine(state); today.settleBudget('late-usage', 0.4);
  const settled = today.getState();
  expect(settled.budget).toMatchObject({ spentUsd: 0, reservedUsd: 0, outstandingReservedUsd: 0 });
  expect(settled.reservations[0]).toMatchObject({ createdAt: dayOne, settledAt: dayTwo, status: 'settled', actualUsd: 0.4 });
  expect(entityDailyCommitment(settled, 'researcher')).toBe(0);
  today.settleBudget('late-usage', 0.4);
  expect(today.getState()).toEqual(settled);
  const originalDay = structuredClone(settled); originalDay.clock = dayOne; refreshDailyBudget(originalDay);
  expect(originalDay.budget.spentUsd).toBe(0.4);
});

it('migrates undated aggregate residuals once and never erases them on rollover or restart', () => {
  const state = createInitialState(); state.mode = 'live'; state.clock = dayOne;
  state.budget = { dailyUsd: 5, reservedUsd: 0.3, spentUsd: 0.2, day: '2026-10-12' };
  refreshDailyBudget(state);
  expect(state.budget.accounting).toMatchObject({ legacyReservedUsd: 0.3, legacySpentByDay: [{ day: '2026-10-12', usd: 0.2 }] });
  const migrated = structuredClone(state); refreshDailyBudget(state); expect(state).toEqual(migrated);
  state.clock = dayTwo; refreshDailyBudget(state);
  expect(state.budget).toMatchObject({ reservedUsd: 0.3, outstandingReservedUsd: 0.3, spentUsd: 0 });
  expect(new WorldEngine(parseWorldState(JSON.stringify(state))).getState()).toEqual(state);
});

it('retains undated reservation holds and measured costs conservatively on every day', () => {
  const state = funded().getState(); state.clock = dayTwo;
  state.reservations = [
    { id: 'unknown-date', entityId: 'researcher', estimatedUsd: 0.4, actualUsd: null, status: 'reserved', createdAt: 'unknown' },
    { id: 'unknown-cost-date', entityId: 'researcher', estimatedUsd: 0.2, actualUsd: 0.2, status: 'settled', createdAt: 'unknown' },
  ];
  refreshDailyBudget(state);
  expect(state.budget).toMatchObject({ reservedUsd: 0.4, spentUsd: 0.2, outstandingReservedUsd: 0.4 });
  expect(entityDailyCommitment(state, 'researcher')).toBeCloseTo(0.6);
});

it('restores conservative residuals from both histories without multiplying repeated restores', () => {
  const current = createInitialState(); current.clock = dayTwo; current.budget.reservedUsd = 0.4; current.budget.spentUsd = 0.2; current.budget.day = '2026-10-13';
  const backup = createInitialState(); backup.clock = dayOne; backup.budget.reservedUsd = 0.3; backup.budget.spentUsd = 0.1; backup.budget.day = '2026-10-12';
  restoreDailyAccounting(backup, current); backup.clock = dayTwo; refreshDailyBudget(backup);
  expect(backup.budget).toMatchObject({ reservedUsd: 0.4, outstandingReservedUsd: 0.4, spentUsd: 0.2 });
  const restored = structuredClone(backup); restoreDailyAccounting(backup, current); refreshDailyBudget(backup);
  expect(backup).toEqual(restored);
});
