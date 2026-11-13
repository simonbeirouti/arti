export type RecoveryStatus = { running: boolean; leaseExpired: boolean; pending: boolean; blocked: boolean; conversationPending?: boolean };

type Candidate = { id: string; lastActiveAt?: string | null };

/** Only safe continuations bypass the personal-work interval; goal priority stays authoritative. */
export function liveTurnDue(entity: Candidate, recovery: RecoveryStatus, assigned: boolean, unfinishedGoal: boolean, scheduledTime: number): boolean {
  if (recovery.blocked || recovery.running && !recovery.leaseExpired) return false;

  return assigned || !unfinishedGoal && (recovery.pending || !entity.lastActiveAt || Date.parse(entity.lastActiveAt) + 30 * 60000 <= scheduledTime);
}

/** Idle residents suggest shared project work; only assignments and saved code slices execute code. */
export function scheduledAction(recovery: RecoveryStatus, assigned: boolean): 'conversation' | 'work' {
  return !assigned && (!recovery.pending || recovery.conversationPending) ? 'conversation' : 'work';
}

/** At most two initialization/status pairs leave room for one authorized runtime slice. */
export function liveCandidateWindow<T extends Candidate>(entities: T[], assigned: Set<string>, unfinishedGoal: boolean, scheduledTime: number): T[] {
  const population = entities.filter(entity => assigned.size ? assigned.has(entity.id) : !unfinishedGoal).sort((left, right) => left.id.localeCompare(right.id));

  if (!population.length) return [];
  const offset = Math.floor(scheduledTime / 60000) % population.length;

  return Array.from({ length: Math.min(2, population.length) }, (_, index) => population[(offset + index) % population.length]);
}
