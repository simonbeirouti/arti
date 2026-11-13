import { expect, it } from 'vitest';
import { assertTurnLease } from './turn-lease';

it('rejects a replaced turn despite its renewed deadline before effects and checkpoint writes', async () => {
  let state = { turnId: 'original', leaseUntil: 100, checkpoint: 2, pendingCommand: 'original' };
  const token = state.turnId;
  let effects = 0;

  const oldCallback = async () => {
    assertTurnLease(state, token, 50);
    await Promise.resolve().then(() => { state = { turnId: 'replacement', leaseUntil: 1000, checkpoint: 7, pendingCommand: 'replacement' }; });
    assertTurnLease(state, token, 50);
    effects += 1;
    state.checkpoint += 1;
    state.pendingCommand = 'cleared';
  };

  await expect(oldCallback()).rejects.toThrow('Turn lease no longer owned');
  expect(effects).toBe(0);
  expect(state).toEqual({ turnId: 'replacement', leaseUntil: 1000, checkpoint: 7, pendingCommand: 'replacement' });
  expect(() => assertTurnLease(state, 'replacement', 50)).not.toThrow();
  expect(() => assertTurnLease(state, 'replacement', 1000)).toThrow();
  expect(() => assertTurnLease({ turnId: null, leaseUntil: 1000 }, null, 50)).toThrow();
});
