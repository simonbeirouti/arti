import { toolFailureReceipt } from '../features/agent-turns/tool-failures';

export type ToolCall = { name: string; arguments: string };

export type ModelTurn = { text: string; calls: ToolCall[] };

export interface TurnModel { next(history: string[]): Promise<ModelTurn> }

export interface ToolExecutor { execute(call: ToolCall): Promise<string> }

export type TurnResult = { status: 'completed' | 'step_limit' | 'blocked'; history: string[]; steps: number };

/** The runtime receives an already authenticated, scoped executor, never raw provider secrets. */
export async function runBoundedTurn(model: TurnModel, tools: ToolExecutor, initial: string[], maxSteps = 12): Promise<TurnResult> {
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 12) throw new Error('Turn limit must be between one and twelve');
  const history = [...initial];
  let failures = 0;
  let steps = 0;

  while (steps < maxSteps) {
    const response = await model.next(history);
    history.push(response.text);

    if (response.calls.length === 0) return { status: 'completed', history, steps };

    for (const call of response.calls) {
      if (steps >= maxSteps) return { status: 'step_limit', history, steps };
      steps += 1;

      try { history.push(JSON.stringify({ tool: call.name, arguments: call.arguments, observation: await tools.execute(call) })); failures = 0; }
      catch (error) { failures += 1; history.push(JSON.stringify(toolFailureReceipt(call.name, error instanceof Error ? error : new Error('Unknown tool failure')))); }

      if (failures >= 3) return { status: 'blocked', history, steps };
    }
  }

  return { status: 'step_limit', history, steps };
}

export class SimulatedModel implements TurnModel {
  private turn = 0;
  async next(_history: string[]): Promise<ModelTurn> {
    this.turn += 1;

    return this.turn === 1 ? { text: 'Simulation: inspect current world before acting', calls: [{ name: 'world.inspect', arguments: '{}' }] } : { text: 'Simulation turn complete; no paid inference used', calls: [] };
  }
}
