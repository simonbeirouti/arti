import { ModelOutputLimitError } from '../../../../packages/provider-adapters/src/cloudflare';
import { ZodError } from 'zod';

const tools = new Set(['world.inspect', 'world.command', 'repo.fork', 'repo.read', 'repo.patch_commit', 'execution.request_build', 'research.retrieve', 'research.browser', 'data.get', 'data.put', 'data.delete']);

export class ToolPermissionError extends Error {}

/** Error messages and arguments are untrusted and never enter failure feedback. */
export type ToolFailureReceipt = { tool: string; code: 'JSON_PARSE' | 'ARGUMENT_SCHEMA' | 'PERMISSION' | 'EXECUTION_FAILED'; status: 'failed' };

export function toolFailureReceipt(name: string, error: Error): ToolFailureReceipt {
  const code = error instanceof SyntaxError ? 'JSON_PARSE' : error instanceof ZodError ? 'ARGUMENT_SCHEMA' : error instanceof ToolPermissionError ? 'PERMISSION' : 'EXECUTION_FAILED';

  return { tool: tools.has(name) ? name : 'unknown', code, status: 'failed' };
}

export class PersonalWorkIncompleteError extends Error {
  constructor() { super('PERSONAL_WORK_INCOMPLETE'); }
}

export const runtimeFailureCodes = ['MODEL_OUTPUT_LIMIT', 'PERSONAL_WORK_INCOMPLETE', 'RUNTIME_FAILED'] as const;

export type RuntimeFailureReceipt = { type: 'runtime.failure'; code: typeof runtimeFailureCodes[number] };

/** Typed local failures only; remote strings and arbitrary exception data stay private. */
export function runtimeFailureReceipt(error: Error): RuntimeFailureReceipt {
  return { type: 'runtime.failure', code: error instanceof ModelOutputLimitError ? 'MODEL_OUTPUT_LIMIT' : error instanceof PersonalWorkIncompleteError ? 'PERSONAL_WORK_INCOMPLETE' : 'RUNTIME_FAILED' };
}
