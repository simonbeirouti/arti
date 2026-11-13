import type { BudgetReservation, WorldState } from '../../contracts/src/index';

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value: string): boolean { return dayPattern.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value; }

export function dispatchDay(reservation: BudgetReservation): string | null {
  const timestamp = reservation.createdAt;

  if (!validDay(timestamp.slice(0, 10)) || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) return null;

  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Unknown dates remain a daily hold; known dispatches belong to their original UTC day. */
export function reservationCommitment(reservation: BudgetReservation, day: string): number {
  const originalDay = dispatchDay(reservation);

  if (originalDay !== null && originalDay !== day) return 0;

  return reservation.status === 'reserved' ? reservation.estimatedUsd : reservation.status === 'settled' ? reservation.actualUsd ?? 0 : 0;
}

/** Migrate aggregate residuals once, then derive counters without rewriting historical receipts. */
export function refreshDailyBudget(state: WorldState): void {
  const budget = state.budget;

  if (!budget.accounting) {
    const trackedReserved = state.reservations.reduce((sum, item) => sum + (item.status === 'reserved' ? item.estimatedUsd : 0), 0);
    const trackedOldSpent = state.reservations.reduce((sum, item) => sum + (item.status === 'settled' && (item.settledAt ?? item.createdAt).slice(0, 10) === budget.day ? item.actualUsd ?? 0 : 0), 0);
    const residualSpent = Math.max(0, budget.spentUsd - trackedOldSpent);
    budget.accounting = { basis: 'dispatch-day-v1', legacyReservedUsd: Math.max(0, budget.reservedUsd - trackedReserved), legacySpentByDay: residualSpent > 0 ? [{ day: validDay(budget.day) ? budget.day : '', usd: residualSpent }] : [] };
  }

  const day = new Date(state.clock).toISOString().slice(0, 10);
  let reserved = budget.accounting.legacyReservedUsd;
  let spent = budget.accounting.legacySpentByDay.reduce((sum, item) => sum + (!validDay(item.day) || item.day === day ? item.usd : 0), 0);
  let outstanding = budget.accounting.legacyReservedUsd;

  for (const reservation of state.reservations) {
    if (reservation.status === 'reserved') {
      outstanding += reservation.estimatedUsd;
      reserved += reservationCommitment(reservation, day);
    }

    if (reservation.status === 'settled') spent += reservationCommitment(reservation, day);
  }

  budget.day = day; budget.reservedUsd = reserved; budget.spentUsd = spent; budget.outstandingReservedUsd = outstanding;
}

export function entityDailyCommitment(state: WorldState, entityId: string): number {
  const day = new Date(state.clock).toISOString().slice(0, 10);

  return state.reservations.reduce((sum, reservation) => sum + (reservation.entityId === entityId ? reservationCommitment(reservation, day) : 0), 0);
}

/** Preserve conservative aggregate residuals from both histories without duplicating replayed backups. */
export function restoreDailyAccounting(restored: WorldState, current: WorldState): void {
  refreshDailyBudget(restored); refreshDailyBudget(current);
  const restoredAccounting = restored.budget.accounting;
  const currentAccounting = current.budget.accounting;

  if (!restoredAccounting || !currentAccounting) throw new Error('Budget migration required');
  restoredAccounting.legacyReservedUsd = Math.max(restoredAccounting.legacyReservedUsd, currentAccounting.legacyReservedUsd);
  const legacySpent = new Map(restoredAccounting.legacySpentByDay.map(item => [item.day, item.usd]));

  for (const item of currentAccounting.legacySpentByDay) legacySpent.set(item.day, Math.max(legacySpent.get(item.day) ?? 0, item.usd));
  restoredAccounting.legacySpentByDay = Array.from(legacySpent, ([day, usd]) => ({ day, usd }));
}
