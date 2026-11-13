import { expect, it } from 'vitest';
import { createInitialState } from '../../../packages/domain/src/index';
import { validateRestore } from './restore';

it('restores validated private state paused and requires explicit live configuration', () => {
  const state = createInitialState();
  expect(() => validateRestore(JSON.stringify(state), false, false)).toThrow('Pause');
  expect(validateRestore(JSON.stringify(state), true, false).paused).toBe(true);
  state.mode = 'live'; state.budget.dailyUsd = 1;
  expect(() => validateRestore(JSON.stringify(state), true, false)).toThrow('Live backup');
  expect(validateRestore(JSON.stringify(state), true, true).mode).toBe('live');
  expect(() => validateRestore('{"schemaVersion":1}', true, true)).toThrow();
});
