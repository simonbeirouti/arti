import { parseWorldState } from '../../../packages/domain/src/index';
import type { WorldState } from '../../../packages/contracts/src/index';

export function validateRestore(input: string, paused: boolean, liveConfigured: boolean): WorldState {
  if (!paused) throw new Error('Pause world before restoring a backup');
  const state = parseWorldState(input);

  if (state.mode === 'live' && (!liveConfigured || state.budget.dailyUsd <= 0)) throw new Error('Live backup requires explicit configured activation');
  state.paused = true;

  return state;
}
