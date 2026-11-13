export type TurnLease = { turnId: string | null; leaseUntil: number };

/** A newer owner's renewed deadline cannot extend an earlier owner's authority. */
export function assertTurnLease(state: TurnLease, token: string | null, now: number): void {
  if (!token || state.turnId !== token || state.leaseUntil <= now) throw new Error('Turn lease no longer owned');
}
