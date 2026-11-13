import { expect, it } from 'vitest';
import { runBoundedTurn, SimulatedModel } from './index';

it('runs simulation without inference', async () => { expect((await runBoundedTurn(new SimulatedModel(), { execute: async () => 'safe fixture' }, [])).status).toBe('completed'); });

it('bounds tool calls and blocks repeated failures', async () => {
  const model = { next: async () => ({ text: 'act', calls: [{ name: 'bounded', arguments: '{}' }] }) };
  expect((await runBoundedTurn(model, { execute: async () => 'ok' }, [])).steps).toBe(12);
  const result = await runBoundedTurn(model, { execute: async () => { throw new Error('denied'); } }, []); expect(result.status).toBe('blocked'); expect(result.steps).toBe(3);
});
