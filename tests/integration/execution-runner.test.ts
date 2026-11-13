import { execFile } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const runner = resolve('apps/execution/features/cloud-build/runner.mjs');

async function fixture(worker: string, tests: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'arti-build-fixture-'));

  try {
    return await new Promise<string>((accept, reject) => {
      const process = execFile(globalThis.process.execPath, [runner], {
        env: { PATH: globalThis.process.env.PATH, ARTI_BUILD_ROOT: workspace, ARTI_COMPILER_ROOT: resolve('.') }, timeout: 20_000,
      }, (error, stdout) => { if (error) reject(error); else accept(stdout); });

      process.stdin?.end(JSON.stringify({ worker, tests }));
    });
  } finally { await rm(workspace, { recursive: true, force: true }); }
}

describe('trusted build driver with local authored fixtures (not cloud evidence)', () => {
  it('compiles real TypeScript, tests saved output, and independently invokes HTTP', async () => {
    const result = await fixture("export default { async fetch(_request: Request): Promise<Response> { return new Response('public fixture'); } };", "import {test} from 'node:test';import assert from 'node:assert/strict';import worker from './output/worker.js';test('saved Worker output',async()=>assert.equal(await (await worker.fetch(new Request('https://fixture.invalid/'))).text(),'public fixture')); ");
    expect(result).toContain('Independent HTTP smoke passed');
    expect(result).toContain('public fixture');
  });
  it('compiles the shipped entity template and verifies scheduled app-data persistence', async () => {
    const [worker, tests] = await Promise.all([readFile('templates/entity/site/worker.ts', 'utf8'), readFile('templates/entity/tests/worker.test.mjs', 'utf8')]);
    const result = await fixture(worker, tests);
    expect(result).toContain('Agent tests passed');
    expect(result).toContain('last-refresh');
  });
  it('rejects compilation and independently detects broken HTTP despite passing agent tests', async () => {
    await expect(fixture("const x: number = 'bad'; export default x;", '')).rejects.toThrow();
    await expect(fixture("export default { fetch(){ return new Response('broken',{status:500}); } };", "import {test} from 'node:test';test('agent claims success',()=>{});")).rejects.toThrow();
  });
});
