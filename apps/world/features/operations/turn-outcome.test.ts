import { describe, expect, it } from 'vitest';
import { runBoundedTurn, type ModelTurn } from '../../../agent-runtime/src/index';
import { recordLiveTurnOutcome, turnOutcomeMetric, type EntityTurnMetric } from './turn-outcome';

describe('live turn outcome observations', () => {
  it('records tool-free completion without asserting a deployment or useful outcome', async () => {
    const metrics: EntityTurnMetric[] = [];
    await recordLiveTurnOutcome(async () => (await runBoundedTurn({ next: async () => ({ text: 'Observed world', calls: [] }) }, { execute: async () => 'unused' }, [])).status, async metric => { metrics.push(metric); });
    expect(metrics).toEqual(['entity.turn_completed']);
  });

  it('distinguishes three failed tool calls from twelve successful calls that exhaust the turn', async () => {
    const response: ModelTurn = { text: 'Attempt scoped tool', calls: [{ name: 'world.inspect', arguments: '{}' }] };
    const model = { next: async () => response };
    const metrics: EntityTurnMetric[] = [];
    await recordLiveTurnOutcome(async () => (await runBoundedTurn(model, { execute: async () => { throw new Error('Rejected tool'); } }, [])).status, async metric => { metrics.push(metric); });
    await recordLiveTurnOutcome(async () => (await runBoundedTurn(model, { execute: async () => 'Checked observation' }, [])).status, async metric => { metrics.push(metric); });
    expect(metrics).toEqual(['entity.turn_blocked', 'entity.turn_step_limit']);
  });

  it('records thrown inference failures without incrementing a completed or legacy success count', async () => {
    const metrics: EntityTurnMetric[] = [];
    await recordLiveTurnOutcome(async () => { throw new Error('Model unavailable'); }, async metric => { metrics.push(metric); });
    expect(metrics).toEqual(['entity.turn_failure']);
    expect(turnOutcomeMetric('completed')).toBe('entity.turn_completed');
    expect(() => turnOutcomeMetric('unexpected')).toThrow();
    expect(() => turnOutcomeMetric('success')).toThrow();
    await recordLiveTurnOutcome(async () => 'unexpected', async metric => { metrics.push(metric); });
    expect(metrics).toEqual(['entity.turn_failure', 'entity.turn_failure']);
  });
});

it('records a yielded slice once as pending without rerunning or claiming completion', async () => {
  let dispatches = 0;
  const metrics: EntityTurnMetric[] = [];
  await recordLiveTurnOutcome(async () => { dispatches += 1;

 return 'pending'; }, async metric => { metrics.push(metric); });
  expect(dispatches).toBe(1);
  expect(metrics).toEqual(['entity.turn_pending']);
  expect(turnOutcomeMetric('pending')).toBe('entity.turn_pending');
});
