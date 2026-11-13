import { expect, it } from 'vitest';
import { LiveGate, measuredModelCost, type ModelResponse } from './cloudflare';

it('settles measured provider tokens using configured prices and preserves unknown cost reservations', async () => {
  const settled: (number | null)[] = [];
  const gate = new LiveGate({ activated: true, dailyAllowanceUsd: 1 }, { reserve: async () => ({ id: 'reservation' }), settle: async (_id, actual) => { settled.push(actual); } });
  const response: ModelResponse = { choices: [{ message: { content: 'done' } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } };
  const pricing = { inputUsdPerMillion: 1, outputUsdPerMillion: 2 };
  const result = await gate.run('builder-1', 0.01, 'model', async () => response, value => measuredModelCost(value, pricing));
  expect(result).toBe(response);
  expect(settled[0]).toBeCloseTo(0.0014);
  await gate.run('builder-1', 0.01, 'model', async () => ({ choices: response.choices }), value => measuredModelCost(value, pricing));
  expect(settled[1]).toBeNull();
  expect(measuredModelCost(response)).toBeNull();
  expect(() => measuredModelCost(response, { inputUsdPerMillion: -1, outputUsdPerMillion: 1 })).toThrow('pricing');
});
