import { z } from 'zod';

const turnStatusSchema = z.enum(['completed', 'blocked', 'step_limit', 'pending']);

export type EntityTurnMetric = 'entity.turn_completed' | 'entity.turn_blocked' | 'entity.turn_step_limit' | 'entity.turn_failure' | 'entity.turn_pending';

/** A resolved bounded turn can still be blocked or exhaust its tool steps. */
export function turnOutcomeMetric(status: string): Exclude<EntityTurnMetric, 'entity.turn_failure'> {
  return `entity.turn_${turnStatusSchema.parse(status)}`;
}

export async function recordLiveTurnOutcome(run: () => Promise<string>, record: (metric: EntityTurnMetric) => Promise<void>): Promise<void> {
  try { await record(turnOutcomeMetric(await run())); }
  catch { await record('entity.turn_failure'); }
}
