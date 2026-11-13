import { z } from 'zod';
import type { ToolCall, ToolExecutor, TurnModel } from '../../src/index';
import { toolFailureReceipt } from './tool-failures';

const callSchema = z.object({ name: z.string().max(100), arguments: z.string().max(400_000) }).strict();

export const sliceStateSchema = z.object({ history: z.array(z.string().max(500_000)).max(50), steps: z.number().int().min(0).max(12), failures: z.number().int().min(0).max(3), calls: z.array(callSchema).max(12), inFlight: callSchema.nullable() }).strict();

export type SliceState = z.infer<typeof sliceStateSchema>;

export type SliceStatus = 'pending' | 'completed' | 'blocked' | 'step_limit';

export type SliceSave = (state: SliceState) => void;

const mutatingTools = new Set(['world.command', 'repo.fork', 'repo.patch_commit', 'execution.request_build', 'data.put', 'data.delete']);

export function freshSlice(): SliceState { return { history: [], steps: 0, failures: 0, calls: [], inFlight: null }; }

export function requireSliceStorage(state: SliceState): void {
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 192_000) throw new Error('Slice exceeds durable byte allowance');
}

/** One tool maximum per inbound request; limits apply to the entire durable logical turn. */
export async function runBoundedSlice(model: TurnModel, tools: ToolExecutor, input: SliceState, save: SliceSave): Promise<{ status: SliceStatus; state: SliceState }> {
  const state = sliceStateSchema.parse(input);
  requireSliceStorage(state);
  const checkpoint = () => { requireSliceStorage(state); save(state); };

  if (state.inFlight) throw new Error('Ambiguous tool delivery requires reconciliation');

  if (state.failures >= 3) return { status: 'blocked', state };

  if (state.steps >= 12) return { status: 'step_limit', state };

  if (state.calls.length === 0) {
    const response = await model.next(state.history);
    state.history.push(response.text);

    if (response.calls.length === 0) { checkpoint();

      return { status: 'completed', state }; }

    state.calls = response.calls.slice(0, 12 - state.steps);
  }

  const call = state.calls.shift();

  if (!call) throw new Error('Missing bounded tool call');
  state.steps += 1; state.inFlight = call;
  checkpoint();

  try { finishSliceCall(state, await tools.execute(call)); }
  catch (error) {
    state.failures += 1;
    const failure = toolFailureReceipt(call.name, error instanceof Error ? error : new Error('Unknown tool failure'));
    state.history.push(JSON.stringify(failure));

    if (failure.code === 'EXECUTION_FAILED' && mutatingTools.has(call.name)) {
      checkpoint();
      throw new Error('Ambiguous tool delivery requires reconciliation');
    }

    state.inFlight = null;
  }

  state.history = state.history.slice(-50);
  checkpoint();

  return { status: state.failures >= 3 ? 'blocked' : state.steps >= 12 ? 'step_limit' : 'pending', state };
}

/** A replayed idempotent world command consumes its original step, never a second step. */
export function finishSliceCall(state: SliceState, observation: string): void {
  const call: ToolCall | null = state.inFlight;

  if (!call) throw new Error('No in-flight tool to complete');
  state.history.push(JSON.stringify({ tool: call.name, arguments: call.arguments, observation }));
  state.failures = 0; state.inFlight = null;
}
