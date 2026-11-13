import { PersonalProgress } from '../../../apps/agent-runtime/features/agent-turns/personal-progress';
import { executionTools } from '../../../apps/agent-runtime/features/agent-turns/execution-tools';
import { assertTurnLease } from '../../../apps/agent-runtime/features/agent-turns/turn-lease';
import { expect, it } from 'vitest';
import { runBoundedTurn } from '../../../apps/agent-runtime/src/index';
import { LiveGate, WorkersAiAdapter, WorkersAiTurnModel, type AiBinding, type ModelResponse, type ModelTool, type ModelTurnInput } from './cloudflare';

type RequestPayload = { max_completion_tokens: number; stream: boolean };

function model(response: ModelResponse, payloads: unknown[], settlements: (number | null)[], reservations: number[] = [], assertDispatch?: () => void, afterReserve?: () => void, select?: () => ModelTurnInput) {
  const gate = new LiveGate({ activated: true, dailyAllowanceUsd: 1 }, { reserve: async (_id, amount) => { reservations.push(amount); afterReserve?.();

 return { id: 'reserved' }; }, settle: async (_id, actual) => { settlements.push(actual); } });

  const ai = { run: async (_name: string, payload: RequestPayload) => { payloads.push(payload);

 return response; } };

  // SAFETY: This fixture implements the only invoked non-streaming run path and returns the validated response contract.
  const adapter = new WorkersAiAdapter(ai as AiBinding, gate, '@cf/zai-org/glm-4.7-flash', { inputUsdPerMillion: 1, outputUsdPerMillion: 2 }, undefined, assertDispatch);

  return new WorkersAiTurnModel(adapter, 'builder-1', 'Public instructions', [], 0.02, select);
}

it('requests bounded 8192-token normal completions and settles measured usage', async () => {
  const payloads: unknown[] = [];
  const settlements: (number | null)[] = [];
  const reservations: number[] = [];
  const turn = await model({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }, payloads, settlements, reservations).next([]);
  expect(reservations).toEqual([0.02]);
  expect(payloads[0]).toMatchObject({ max_completion_tokens: 8192, stream: false });
  expect(payloads[0]).not.toHaveProperty('tool_choice');
  expect(payloads[0]).not.toHaveProperty('parallel_tool_calls');
  expect(turn).toEqual({ text: 'done', calls: [] });
  expect(settlements[0]).toBeCloseTo(0.0002);
});

it('rejects length-truncated completion and tool calls without dispatch or secret feedback', async () => {
  const canary = 'PRIVATE-TRUNCATED-CANARY';

  for (const message of [{ content: canary }, { content: null, tool_calls: [{ function: { name: 'repo.patch_commit', arguments: canary } }] }]) {
    let executions = 0;
    const settlements: (number | null)[] = [];
    const runtime = model({ choices: [{ finish_reason: 'length', message }], usage: { prompt_tokens: 100, completion_tokens: 8192 } }, [], settlements);
    await expect(runBoundedTurn(runtime, { execute: async () => { executions += 1;

 return 'unexpected'; } }, [])).rejects.toThrow(/^MODEL_OUTPUT_LIMIT$/);
    expect(executions).toBe(0);
    expect(settlements[0]).toBeCloseTo(0.016484);
  }
});

it('rechecks lease ownership after reservation before paid inference and retains unknown costs', async () => {
  let lease = { turnId: 'old', leaseUntil: 100 };
  const payloads: unknown[] = [];
  const settlements: (number | null)[] = [];
  const reservations: number[] = [];
  const runtime = model({ choices: [{ message: { content: 'unexpected' } }] }, payloads, settlements, reservations, () => assertTurnLease(lease, 'old', 50), () => { lease = { turnId: 'new', leaseUntil: 1000 }; });
  await expect(runtime.next([])).rejects.toThrow('Turn lease no longer owned');
  expect(reservations).toEqual([0.02]);
  expect(payloads).toEqual([]);
  expect(settlements).toEqual([null]);
  expect(lease).toEqual({ turnId: 'new', leaseUntil: 1000 });
});

it('requires one current-stage bootstrap tool and fails closed if the provider still returns no call', async () => {
  const taskId = 'personal-builder-1-public-site';
  const progress = new PersonalProgress(taskId);
  progress.succeeded('world.inspect', '{}', '{}');
  const fork = executionTools.find(tool => tool.function.name === 'repo.fork');

  if (!fork) throw new Error('Missing fork fixture');
  const payloads: unknown[] = [];
  const reservations: number[] = [];
  const settlements: (number | null)[] = [];
  const runtime = model({ choices: [{ finish_reason: 'stop', message: { content: 'I am done' } }] }, payloads, settlements, reservations, undefined, undefined, () => ({ instructions: progress.instruction(), tools: [progress.toolSchema(fork)], toolChoice: 'required' }));
  let executions = 0;
  await expect(runBoundedTurn(progress.model(runtime), { execute: async () => { executions += 1;

 return 'unexpected'; } }, [])).rejects.toThrow();
  expect(payloads).toHaveLength(1);
  expect(payloads[0]).toMatchObject({ response_format: { type: 'json_schema', json_schema: { name: 'scoped_arguments', strict: true, schema: { properties: { taskId: { enum: [taskId] } } } } }, temperature: 0 });
  expect(payloads[0]).not.toHaveProperty('tools');
  expect(payloads[0]).not.toHaveProperty('tool_choice');
  expect(reservations).toEqual([0.02]);
  expect(executions).toBe(0);
  expect(progress.nextAction()?.tool).toBe('repo.fork');
});

it('rejects an empty required-tool configuration without inference or reservation', async () => {
  const payloads: unknown[] = [];
  const reservations: number[] = [];
  const runtime = model({ choices: [{ message: { content: 'unexpected' } }] }, payloads, [], reservations, undefined, undefined, () => ({ instructions: 'Invalid fixture', tools: [], toolChoice: 'required' }));
  await expect(runtime.next([])).rejects.toThrow('Required model tool set is empty');
  expect(payloads).toEqual([]);
  expect(reservations).toEqual([]);
});


it('normalizes scoped flat string arguments with the server selected operation and measured billing', async () => {
  const fork = executionTools.find(tool => tool.function.name === 'repo.fork')!;
  const payloads: unknown[] = [];
  const settlements: (number | null)[] = [];
  const runtime = model({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ taskId: 'personal-builder-1-public-site' }) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }, payloads, settlements, [], undefined, undefined, () => ({ instructions: 'Public work', tools: [fork], toolChoice: 'required' }));
  expect(await runtime.next([])).toEqual({ text: '', calls: [{ name: 'repo.fork', arguments: '{"taskId":"personal-builder-1-public-site"}' }] });
  expect(settlements[0]).toBeCloseTo(0.00005);
});

it('uses structured empty-object arguments for the initial public inspection stage', async () => {
  const progress = new PersonalProgress('personal-builder-1-public-site');
  const inspect: ModelTool = { type: 'function', function: { name: 'world.inspect', description: 'Read public observed world state', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } };
  const payloads: unknown[] = [];
  const reservations: number[] = [];
  const settlements: (number | null)[] = [];
  const runtime = model({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }, payloads, settlements, reservations, undefined, undefined, () => ({ instructions: progress.instruction(), tools: [progress.toolSchema(inspect)], toolChoice: 'required' }));
  const turn = await progress.model(runtime).next([]);

  expect(turn).toEqual({ text: '', calls: [{ name: 'world.inspect', arguments: '{}' }] });
  expect(payloads[0]).toMatchObject({ response_format: { type: 'json_schema', json_schema: { strict: true, schema: { type: 'object', properties: {}, required: [], additionalProperties: false } } }, temperature: 0 });
  expect(payloads[0]).not.toHaveProperty('tools');
  expect(payloads[0]).not.toHaveProperty('tool_choice');
  expect(reservations).toEqual([0.02]);
  expect(settlements[0]).toBeCloseTo(0.000014);
  expect(progress.nextAction()?.tool).toBe('world.inspect');
  progress.require(turn.calls[0].name, turn.calls[0].arguments);
  progress.succeeded(turn.calls[0].name, turn.calls[0].arguments, '{}');
  expect(progress.nextAction()?.tool).toBe('repo.fork');
});

it.each(['not JSON', '{"taskId":123}', '{"tool":"increase_budget","arguments":{}}', 'null'])('rejects invalid structured content without fallback or a second inference: %s', async content => {
  const fork = executionTools.find(tool => tool.function.name === 'repo.fork')!;
  const payloads: unknown[] = [];
  const settlements: (number | null)[] = [];
  const runtime = model({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }, payloads, settlements, [], undefined, undefined, () => ({ instructions: 'Public work', tools: [fork], toolChoice: 'required' }));
  await expect(runtime.next([])).rejects.toThrow();
  expect(payloads).toHaveLength(1);
  expect(settlements[0]).toBeCloseTo(0.00005);
});

it('does not let structured output choose its tool and retains strict executor validation', async () => {
  const { executionInput } = await import('../../../apps/agent-runtime/features/agent-turns/execution-tools');
  const fork = executionTools.find(tool => tool.function.name === 'repo.fork')!;
  const runtime = model({ choices: [{ message: { content: '{"taskId":"personal-builder-1-public-site","name":"increase_budget"}' } }] }, [], [], [], undefined, undefined, () => ({ instructions: 'Public work', tools: [fork], toolChoice: 'required' }));
  const turn = await runtime.next([]);
  expect(turn.calls[0].name).toBe('repo.fork');
  expect(() => executionInput(turn.calls[0].name, turn.calls[0].arguments)).toThrow();
});

it('preserves native multi-tool required requests', async () => {
  const payloads: unknown[] = [];
  const response = { choices: [{ message: { tool_calls: [{ function: { name: 'repo.fork', arguments: '{"taskId":"personal-builder-1-public-site"}' } }] } }] };
  const runtime = model(response, payloads, [], [], undefined, undefined, () => ({ instructions: 'Public work', tools: executionTools.slice(0, 2), toolChoice: 'required' }));
  expect((await runtime.next([])).calls[0].name).toBe('repo.fork');
  expect(payloads[0]).toMatchObject({ tool_choice: 'required', parallel_tool_calls: false });
  expect(payloads[0]).not.toHaveProperty('response_format');
});

it('rejects native operation injection on the structured route without dispatch', async () => {
  const fork = executionTools.find(tool => tool.function.name === 'repo.fork')!;
  const runtime = model({ choices: [{ message: { content: '{"taskId":"personal-builder-1-public-site"}', tool_calls: [{ function: { name: 'increase_budget', arguments: '{}' } }] } }] }, [], [], [], undefined, undefined, () => ({ instructions: 'Public work', tools: [fork], toolChoice: 'required' }));
  await expect(runtime.next([])).rejects.toThrow('Invalid scoped argument response');
});

it('preserves truncated-output classification on the structured route', async () => {
  const fork = executionTools.find(tool => tool.function.name === 'repo.fork')!;
  const settlements: (number | null)[] = [];
  const runtime = model({ choices: [{ finish_reason: 'length', message: { content: '{"taskId":' } }], usage: { prompt_tokens: 10, completion_tokens: 8192 } }, [], settlements, [], undefined, undefined, () => ({ instructions: 'Public work', tools: [fork], toolChoice: 'required' }));
  await expect(runtime.next([])).rejects.toThrow(/^MODEL_OUTPUT_LIMIT$/);
  expect(settlements[0]).toBeCloseTo(0.016394);
});
