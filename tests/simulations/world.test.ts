import { expect, it } from 'vitest';
import { WorldEngine, parseWorldState } from '../../packages/domain/src/index';
import type { Command } from '../../packages/contracts/src/index';

it('replays an interrupted world identically with safe public conversations and adaptation', () => {
  const original = new WorldEngine(); const actor = { role: 'operator' as const };
  const created = original.dispatch(actor, { type: 'goal.create', objective: 'PRIVATE_SECRET create a knowledge resource', criteria: ['The guide has provenance'], constraints: [] }, 'create-replay');
  original.dispatch(actor, { type: 'goal.start', goalId: created.goals[0]?.id ?? '' }, 'start-replay');
  const restored = new WorldEngine(parseWorldState(JSON.stringify(original.getState())));

  for (let step = 0; step < 12; step += 1) {
    const command: Command = { type: 'world.tick' };
    original.dispatch(actor, command, `replay-tick-${step}`); restored.dispatch(actor, command, `replay-tick-${step}`);
  }

  expect(restored.getState()).toEqual(original.getState());
  expect(restored.getPublicState().discussions).toHaveLength(8);
  expect(JSON.stringify(restored.getPublicState())).not.toContain('PRIVATE_SECRET');
  expect(restored.getState().entities.every(entity => entity.personality.includes('evidence-minded'))).toBe(true);
});

it('rejects live simulation and leaves world state unchanged', () => {
  const initial = new WorldEngine().getState(); initial.mode = 'live'; const engine = new WorldEngine(initial);
  expect(() => engine.dispatch({ role: 'system' }, { type: 'world.tick' }, 'live-tick-test')).toThrow('Simulation ticks');
  expect(engine.getState()).toEqual(initial);
});
