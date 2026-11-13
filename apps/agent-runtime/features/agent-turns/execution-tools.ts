import { z } from 'zod';
import type { ModelTool } from '../../../../packages/provider-adapters/src/cloudflare';

const taskId = z.string().min(1).max(100);

const commit = z.string().regex(/^[a-f0-9]{40}$/);

const path = z.string().min(1).max(200);

export const executionArguments = {
  'repo.fork': z.object({ taskId }).strict(),
  'repo.read': z.object({ taskId, commit, path }).strict(),
  'repo.patch_commit': z.object({ taskId, path, content: z.string().max(200_000), message: z.string().min(1).max(500) }).strict(),
  'execution.request_build': z.object({ taskId, commit }).strict(),
  'research.retrieve': z.object({ url: z.string().url().max(4000), taskId: taskId.optional() }).strict(),
  'research.browser': z.object({ url: z.string().url().max(4000), taskId: taskId.optional() }).strict(),
  'data.get': z.object({ key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/) }).strict(),
  'data.put': z.object({ key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/), value: z.string().max(32_000) }).strict(),
  'data.delete': z.object({ key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/) }).strict(),
};

const executionName = z.enum(['repo.fork', 'repo.read', 'repo.patch_commit', 'execution.request_build', 'research.retrieve', 'research.browser', 'data.get', 'data.put', 'data.delete']);

// All initial execution arguments are flat strings. Validate the generated schema rather than casting it.
const parameters = z.object({ type: z.literal('object'), properties: z.record(z.string(), z.object({ type: z.literal('string'), description: z.string().optional(), minLength: z.number().optional(), maxLength: z.number().optional(), pattern: z.string().optional(), format: z.string().optional() }).passthrough()), required: z.array(z.string()).default([]), additionalProperties: z.literal(false) });

export const executionTools: ModelTool[] = executionName.options.map(name => ({
  type: 'function',
  function: { name, description: `Scoped ${name}. Pass native named arguments directly; scope is enforced by the platform.`, parameters: parameters.parse(z.toJSONSchema(executionArguments[name])) },
}));

/** Convert one validated native call to the existing internal gateway's JSON transport. */
export function executionInput(name: string, argumentsJson: string): string {
  const tool = executionName.parse(name);

  return JSON.stringify(executionArguments[tool].parse(JSON.parse(argumentsJson)));
}

export function isExecutionTool(name: string): boolean { return executionName.safeParse(name).success; }
