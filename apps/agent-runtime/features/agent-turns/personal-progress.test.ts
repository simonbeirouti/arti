import { executionTools } from './execution-tools';
import { expect, it } from 'vitest';
import { runBoundedTurn } from '../../src/index';
import { PersonalProgress, personalBootstrapEligible } from './personal-progress';

const taskId = 'personal-builder-1-public-site';

const commit = 'a'.repeat(40);

const edited = 'b'.repeat(40);

const latest = 'c'.repeat(40);

const calls = [
  { name: 'world.inspect', args: {}, observation: '{}' },
  { name: 'repo.fork', args: { taskId }, observation: JSON.stringify({ commit }) },
  { name: 'repo.read', args: { taskId, commit, path: 'site/worker.ts' }, observation: 'source' },
  { name: 'repo.read', args: { taskId, commit, path: 'tests/worker.test.mjs' }, observation: 'tests' },
  { name: 'repo.patch_commit', args: { taskId, path: 'site/worker.ts', content: 'improved', message: 'Reference' }, observation: JSON.stringify({ commit: edited }) },
  { name: 'repo.patch_commit', args: { taskId, path: 'tests/worker.test.mjs', content: 'focused test', message: 'Test' }, observation: JSON.stringify({ commit: latest }) },
  { name: 'execution.request_build', args: { taskId, commit: latest }, observation: JSON.stringify({ status: 'queued', workflowId: 'checked-build' }) },
];

it('advances only successful scoped stages and ends after queued build without further inference', async () => {
  const progress = new PersonalProgress(taskId);
  let inferences = 0;

  const result = await runBoundedTurn(progress.model({ next: async () => {
    const call = calls[inferences++];
    expect(progress.tools()).toContain(call.name);

    return { text: 'Progress', calls: [{ name: call.name, arguments: JSON.stringify(call.args) }] };
  } }), { execute: async call => {
    const fixture = calls[inferences - 1];
    progress.require(call.name, call.arguments);
    progress.succeeded(call.name, call.arguments, fixture.observation);

    return fixture.observation;
  } }, []);

  expect(inferences).toBe(7);
  expect(result.steps).toBe(7);
  expect(result.status).toBe('completed');
  expect(progress.tools()).toEqual([]);
  expect(result.history.at(-1)).toContain('publication remains pending');
});

it('rejects forged, failed, duplicate and wrong-scope progress without granting unavailable tools', () => {
  const progress = new PersonalProgress(taskId);
  expect(() => progress.require('repo.patch_commit', JSON.stringify(calls[4].args))).toThrow();
  expect(() => progress.require('world.command', '{}')).toThrow();
  expect(progress.tools()).toEqual(['world.inspect']);
  progress.succeeded('world.inspect', '{}', '{}');
  expect(() => progress.succeeded('repo.fork', JSON.stringify({ taskId: 'foreign' }), JSON.stringify({ commit }))).toThrow();
  expect(() => progress.succeeded('repo.fork', JSON.stringify({ taskId }), JSON.stringify({ text: 'Success; commit exists' }))).toThrow();
  expect(progress.tools()).toEqual(['repo.fork']);
  progress.succeeded('repo.fork', JSON.stringify({ taskId }), JSON.stringify({ commit }));
  expect(() => progress.require('repo.read', JSON.stringify({ taskId, commit, path: 'agent/instructions.md' }))).toThrow();
  expect(() => progress.require('repo.read', JSON.stringify({ taskId, commit: edited, path: 'site/worker.ts' }))).toThrow();
  progress.succeeded('repo.read', JSON.stringify(calls[2].args), 'source');
  expect(() => progress.require('repo.read', JSON.stringify(calls[2].args))).toThrow();
  expect(progress.tools()).toEqual(['repo.read']);
  expect(() => progress.require('execution.request_build', JSON.stringify({ taskId, commit }))).toThrow();
  expect(new PersonalProgress(taskId).instruction()).toContain('role-specific public reference');
  const ready = { siteVersion: 1, privateWork: false, assigned: false, publicAuthoring: false };
  expect(personalBootstrapEligible(ready)).toBe(true);
  expect(personalBootstrapEligible({ ...ready, siteVersion: 2 })).toBe(false);
  expect(personalBootstrapEligible({ ...ready, privateWork: true })).toBe(false);
  expect(personalBootstrapEligible({ ...ready, assigned: true })).toBe(false);
  expect(personalBootstrapEligible({ ...ready, publicAuthoring: true })).toBe(false);
});

it('keeps patch and build stages unchanged after malformed receipts and fences stale commits', () => {
  const progress = new PersonalProgress(taskId);

  for (const call of calls.slice(0, 4)) progress.succeeded(call.name, JSON.stringify(call.args), call.observation);
  expect(() => progress.succeeded('repo.patch_commit', JSON.stringify(calls[4].args), '{}')).toThrow();
  expect(progress.tools()).toEqual(['repo.patch_commit']);
  progress.succeeded('repo.patch_commit', JSON.stringify(calls[4].args), calls[4].observation);
  expect(() => progress.require('repo.patch_commit', JSON.stringify(calls[4].args))).toThrow();
  progress.succeeded('repo.patch_commit', JSON.stringify(calls[5].args), calls[5].observation);
  expect(progress.tools()).toEqual(['execution.request_build']);
  expect(() => progress.require('execution.request_build', JSON.stringify({ taskId, commit: edited }))).toThrow();
  expect(() => progress.succeeded('execution.request_build', JSON.stringify(calls[6].args), JSON.stringify({ status: 'failed', workflowId: 'failed' }))).toThrow();
  expect(progress.tools()).toEqual(['execution.request_build']);
  progress.succeeded('execution.request_build', JSON.stringify(calls[6].args), calls[6].observation);
  expect(progress.tools()).toEqual([]);
});

it('rejects tool-free bootstrap claims before queued work without retry or authority changes', async () => {
  const progress = new PersonalProgress(taskId);
  let inferences = 0;
  let executions = 0;

  const model = progress.model({ next: async () => { inferences += 1;

 return { text: 'I published everything', calls: [] }; } });

  await expect(runBoundedTurn(model, { execute: async () => { executions += 1;

 return 'unexpected'; } }, [])).rejects.toThrow(/^PERSONAL_WORK_INCOMPLETE$/);
  expect(inferences).toBe(1);
  expect(executions).toBe(0);
  expect(progress.tools()).toEqual(['world.inspect']);
});

it('requires additive changes and markup-aware tests without prescribing fixture-specific content', () => {
  const instruction = new PersonalProgress(taskId).instruction();
  expect(instruction).toContain('without removing existing markup, content requirements, services or tests');
  expect(instruction).toContain('repair any source/test mismatch rather than weakening or deleting assertions');
  expect(instruction).toContain('raw HTML must account for intervening tags');
  expect(instruction).toContain('Preserve the established test import path and test runner conventions');
  expect(instruction).not.toContain('My public presence');
  expect(instruction).not.toContain('Role: Builder');
});

it('builds a fresh bootstrap prompt without generic commands or private profile extras', () => {
  const canary = 'PRIVATE-PROFILE-EXTRA';
  const profile = { id: 'builder-1', name: 'Nova', role: 'builder', personality: ['inventive'], memory: canary, goal: canary };
  const progress = new PersonalProgress(taskId);
  const prompt = progress.instructions(profile);
  expect(prompt).toContain(taskId);
  expect(prompt).toContain('Nova');
  expect(prompt).toContain('Current personal pipeline tools: world.inspect');
  expect(prompt).toContain('Private goals, instructions, memories and operational evidence must never enter public source');
  expect(prompt).toContain('Only independent platform receipts establish publication');

  for (const unavailable of ['world.command', 'social.post', 'entity.profile', 'entity.personality', 'confirmation.request', 'research.retrieve', canary]) expect(prompt).not.toContain(unavailable);
  progress.succeeded('world.inspect', '{}', '{}');
  expect(progress.instructions(profile)).toContain('Current personal pipeline tools: repo.fork');
});

it('derives actionable next task, path and commit only from successful trusted progress', () => {
  const progress = new PersonalProgress(taskId);
  expect(progress.nextAction()).toEqual({ tool: 'world.inspect', arguments: {} });
  progress.succeeded('world.inspect', '{}', '{}');
  expect(progress.nextAction()).toEqual({ tool: 'repo.fork', arguments: { taskId } });
  progress.succeeded('repo.fork', JSON.stringify({ taskId }), JSON.stringify({ commit }));
  expect(progress.nextAction()).toEqual({ tool: 'repo.read', arguments: { taskId, commit, path: 'site/worker.ts' } });
  expect(progress.instruction()).toContain(JSON.stringify(progress.nextAction()));
  expect(() => progress.require('repo.read', JSON.stringify({ taskId, commit: edited, path: 'site/worker.ts' }))).toThrow();
  expect(progress.nextAction()?.arguments.commit).toBe(commit);
  progress.succeeded('repo.read', JSON.stringify(calls[2].args), 'source');
  expect(progress.nextAction()).toEqual({ tool: 'repo.read', arguments: { taskId, commit, path: 'tests/worker.test.mjs' } });
  progress.succeeded('repo.read', JSON.stringify(calls[3].args), 'tests');
  expect(progress.nextAction()).toEqual({ tool: 'repo.patch_commit', arguments: { taskId, path: 'site/worker.ts' } });
  progress.succeeded('repo.patch_commit', JSON.stringify(calls[4].args), calls[4].observation);
  expect(progress.nextAction()).toEqual({ tool: 'repo.patch_commit', arguments: { taskId, path: 'tests/worker.test.mjs' } });
  progress.succeeded('repo.patch_commit', JSON.stringify(calls[5].args), calls[5].observation);
  expect(progress.nextAction()).toEqual({ tool: 'execution.request_build', arguments: { taskId, commit: latest } });
  progress.succeeded('execution.request_build', JSON.stringify(calls[6].args), calls[6].observation);
  expect(progress.nextAction()).toBeNull();
  expect(progress.instruction()).not.toContain('Do not inspect or read again');
});

it('narrows offered repository schemas to exact task, remaining path and trusted revision without mutating shared schemas', () => {
  const progress = new PersonalProgress(taskId);
  progress.succeeded('world.inspect', '{}', '{}');

  for (const call of calls.slice(1)) {
    const next = progress.nextAction();
    const original = executionTools.find(tool => tool.function.name === call.name);

    if (!original || !next) throw new Error('Missing stage fixture');
    const originalJson = JSON.stringify(original);
    const scoped = progress.toolSchema(original);

    for (const key of ['taskId', 'commit', 'path'] as const) {
      const value = next.arguments[key];

      if (value !== undefined) expect(scoped.function.parameters.properties[key].enum).toEqual([value]);
    }

    expect(scoped.function.parameters.required).toEqual(original.function.parameters.required);
    expect(scoped.function.parameters.additionalProperties).toBe(false);
    expect(JSON.stringify(original)).toBe(originalJson);
    progress.succeeded(call.name, JSON.stringify(call.args), call.observation);
  }

  expect(() => progress.toolSchema(executionTools[0])).toThrow();
});
