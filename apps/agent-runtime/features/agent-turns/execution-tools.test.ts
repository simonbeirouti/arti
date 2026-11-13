import { describe, expect, it } from 'vitest';
import { executionInput, executionTools, isExecutionTool } from './execution-tools';

const revision = 'a'.repeat(40);

const calls = [
  { name: 'repo.fork', args: { taskId: 'personal-builder-1-public-site' } },
  { name: 'repo.read', args: { taskId: 'personal-builder-1-public-site', commit: revision, path: 'site/worker.ts' } },
  { name: 'repo.patch_commit', args: { taskId: 'personal-builder-1-public-site', path: 'site/worker.ts', content: 'export default { fetch(){ return new Response("quoted\\ncontent"); } };\n', message: 'Checked source edit' } },
  { name: 'execution.request_build', args: { taskId: 'personal-builder-1-public-site', commit: revision } },
  { name: 'research.retrieve', args: { url: 'https://developers.cloudflare.com/workers/' } },
  { name: 'research.browser', args: { url: 'https://developer.mozilla.org/en-US/', taskId: 'assigned-research' } },
  { name: 'data.get', args: { key: 'public-counter' } },
  { name: 'data.put', args: { key: 'public-counter', value: 'line one\n"line two"' } },
  { name: 'data.delete', args: { key: 'public-counter' } },
];

describe('native model execution arguments', () => {
  it('serializes each native argument object once for the unchanged scoped gateway', () => {
    for (const call of calls) {
      expect(isExecutionTool(call.name)).toBe(true);
      expect(JSON.parse(executionInput(call.name, JSON.stringify(call.args)))).toEqual(call.args);
      const definition = executionTools.find(tool => tool.function.name === call.name);
      expect(definition?.function.parameters.additionalProperties).toBe(false);
      expect(definition?.function.parameters.properties).not.toHaveProperty('input');

      for (const field of definition?.function.parameters.required ?? []) expect(call.args).toHaveProperty(field);
    }

    expect(executionTools).toHaveLength(calls.length);
    expect(executionTools.find(tool => tool.function.name === 'repo.read')?.function.parameters.properties.commit?.pattern).toBe('^[a-f0-9]{40}$');
  });

  it('rejects legacy double encoding, caller identity, unknown fields and unknown tools before dispatch', () => {
    for (const call of calls) {
      expect(() => executionInput(call.name, JSON.stringify({ input: JSON.stringify(call.args) }))).toThrow();
      expect(() => executionInput(call.name, JSON.stringify({ ...call.args, entityId: 'steward' }))).toThrow();
      expect(() => executionInput(call.name, JSON.stringify({ ...call.args, unrecognized: true }))).toThrow();
    }

    expect(isExecutionTool('operator.deploy')).toBe(false);
    expect(() => executionInput('operator.deploy', '{}')).toThrow();
    expect(() => executionInput('repo.fork', '{broken')).toThrow();
  });

  it('requires exact tool fields and bounded values rather than forwarding malformed arguments', () => {
    expect(() => executionInput('repo.read', JSON.stringify({ taskId: 'assigned', commit: 'main', path: 'site/worker.ts' }))).toThrow();
    expect(() => executionInput('repo.patch_commit', JSON.stringify({ taskId: 'assigned', path: 'site/worker.ts', content: 'source' }))).toThrow();
    expect(() => executionInput('data.get', JSON.stringify({ key: '../other/private' }))).toThrow();
    expect(() => executionInput('data.put', JSON.stringify({ key: 'public', value: 'x'.repeat(32_001) }))).toThrow();
    expect(() => executionInput('research.retrieve', JSON.stringify({ url: 'not-a-url' }))).toThrow();
    expect(() => executionInput('repo.fork', JSON.stringify({ taskId: 'x'.repeat(101) }))).toThrow();
  });
});
