import { expect, it } from 'vitest';
import { z } from 'zod';
import { runBoundedTurn } from '../../src/index';
import { ToolPermissionError, toolFailureReceipt } from './tool-failures';

it('classifies failures without copying untrusted names, messages or arguments', async () => {
  const canary = 'PRIVATE-SECRET-CANARY';
  const schemaError = z.string().safeParse({ secret: canary });

  if (schemaError.success) throw new Error('Invalid fixture');
  const errors = [new SyntaxError(canary), schemaError.error, new ToolPermissionError(canary), new Error(`permission denied ${canary}`)];
  const codes = ['JSON_PARSE', 'ARGUMENT_SCHEMA', 'PERMISSION', 'EXECUTION_FAILED'];

  for (let index = 0; index < errors.length; index += 1) {
    expect(toolFailureReceipt('repo.patch_commit', errors[index])).toEqual({ tool: 'repo.patch_commit', code: codes[index], status: 'failed' });
    expect(JSON.stringify(toolFailureReceipt(canary, errors[index]))).not.toContain(canary);
    expect(toolFailureReceipt(canary, errors[index]).tool).toBe('unknown');
  }

  const result = await runBoundedTurn({ next: async () => ({ text: '', calls: [{ name: 'repo.patch_commit', arguments: canary }] }) }, { execute: async () => { throw new SyntaxError(canary); } }, []);
  expect(result.status).toBe('blocked');
  expect(result.steps).toBe(3);
  expect(result.history.filter(Boolean)).toEqual(Array(3).fill(JSON.stringify({ tool: 'repo.patch_commit', code: 'JSON_PARSE', status: 'failed' })));
  expect(JSON.stringify(result.history)).not.toContain(canary);
});

it('retains only typed fixed terminal failure categories without exception text', async () => {
  const { ModelOutputLimitError } = await import('../../../../packages/provider-adapters/src/cloudflare');
  const { runtimeFailureReceipt, PersonalWorkIncompleteError } = await import('./tool-failures');
  expect(runtimeFailureReceipt(new ModelOutputLimitError())).toEqual({ type: 'runtime.failure', code: 'MODEL_OUTPUT_LIMIT' });
  expect(runtimeFailureReceipt(new PersonalWorkIncompleteError())).toEqual({ type: 'runtime.failure', code: 'PERSONAL_WORK_INCOMPLETE' });
  const canary = 'PRIVATE-TERMINAL-SECRET';
  expect(runtimeFailureReceipt(new Error(`MODEL_OUTPUT_LIMIT ${canary}`))).toEqual({ type: 'runtime.failure', code: 'RUNTIME_FAILED' });
  expect(JSON.stringify(runtimeFailureReceipt(new Error(canary)))).not.toContain(canary);
});
