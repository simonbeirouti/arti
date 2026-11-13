import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import type { Deployment } from '../../../../packages/contracts/src/index';
import { publishVisitorBaseline, type BaselineServices } from './pipeline';
import { helloWorldWorker, helloWorldTests, helloWorldBaselineHash, verifyHelloWorldResponse } from './content';

const resetId = 'c5190033-e240-4edf-b0e0-20623c9571fa';

function fixture() {
  const events: string[] = [];
  let head = 'a'.repeat(40);
  let saved: Deployment | null = null;
  let checkpoint: string | null = null;
  let hasSource = false;
  let reserved = 0;
  const output = { compiled: 'trusted compiled Hello World bundle', assertions: ['TypeScript compiled', 'Agent tests passed', 'Independent HTTP smoke passed'] };

  const services: BaselineServices = {
    authority: {
      authorize: async () => { events.push('authorize');

 return { projectId: 'collective', repository: 'collective', deployment: saved }; },
      reserve: async (_reset, _attempt, amount, operation) => { reserved += amount; events.push(`reserve:${operation}`);

 if (reserved > 0.05) throw new Error('Bootstrap allowance exhausted');

 return { id: `hold-${events.length}` }; },
      settle: async (_id, actual) => { expect(actual).toBeNull(); },
      complete: async (_reset, _attempt, deployment, hash, assertions) => { expect(hash).toBe(await helloWorldBaselineHash()); expect(assertions).toContain('Production Hello World HTTP verified'); events.push('complete'); saved = deployment; },
      release: async () => { events.push('release'); },
    },
    checkpoint: async () => checkpoint,
    saveCheckpoint: async (_id, value) => { checkpoint = JSON.stringify(value); },
    canonicalHead: async () => head,
    matchesSource: async () => hasSource,
    appendSource: async () => { events.push('append'); hasSource = true; head = 'b'.repeat(40);

 return head; },
    build: async () => { events.push('build');

 return output; },
    saveBundle: async () => { events.push('save-bundle'); },
    readBundle: async () => output.compiled,
    upload: async (environment, _bundle, _name, gate) => { await gate.run('platform-bootstrap', 0.001, 'deployment.upload', async () => { events.push(`upload:${environment}`); }); },
    smoke: async environment => { events.push(`smoke:${environment}`);

 return new Response('<h1>Hello, world.</h1><small>Platform-provided starting page</small>', { headers: { 'Content-Type': 'text/html' } }); },
  };

  return { services, events, get reserved() { return reserved; }, setHead(value: string) { head = value; }, clearSaved() { saved = null; } };
}

it('builds and publishes a checked platform-authored version-one baseline within its dedicated reset allowance', async () => {
  const run = fixture();
  const result = await publishVisitorBaseline(resetId, run.services);
  expect(result).toMatchObject({ id: `deployment-platform-baseline-${resetId}`, projectId: 'collective', authorship: 'platform', version: 1, environment: 'production', commit: 'b'.repeat(40) });
  expect(result).not.toHaveProperty('goalId');
  expect(result).not.toHaveProperty('taskId');
  expect(run.events.indexOf('build')).toBeLessThan(run.events.indexOf('upload:staging'));
  expect(run.events.indexOf('smoke:staging')).toBeLessThan(run.events.indexOf('upload:production'));
  expect(run.events.indexOf('smoke:production')).toBeLessThan(run.events.indexOf('complete'));
  expect(run.events.at(-1)).toBe('release');
  expect(run.reserved).toBeCloseTo(0.033);
});

it('returns the exact saved canonical baseline without redispatch or duplicate reservations', async () => {
  const run = fixture();
  const result = await publishVisitorBaseline(resetId, run.services);
  const before = run.reserved;
  expect(await publishVisitorBaseline(resetId, run.services)).toEqual(result);
  expect(run.reserved).toBe(before);
  expect(run.events.filter(event => event === 'build')).toHaveLength(1);
});

it('performs no build, Git or upload when world authority rejects the paused reset permit', async () => {
  const run = fixture();
  run.services.authority.authorize = async () => { throw new Error('Reset permit required'); };

  await expect(publishVisitorBaseline(resetId, run.services)).rejects.toThrow('permit');
  expect(run.events).toEqual([]);
  expect(run.reserved).toBe(0);
});

it('never uploads production or records a receipt after failed staging content verification', async () => {
  const run = fixture();
  run.services.smoke = async () => new Response('Different page', { headers: { 'Content-Type': 'text/html' } });
  await expect(publishVisitorBaseline(resetId, run.services)).rejects.toThrow('content mismatch');
  expect(run.events).not.toContain('upload:production');
  expect(run.events).not.toContain('complete');
  expect(run.events.at(-1)).toBe('release');
});

it('recovers an uncertain completion using its exact retained bundle and commit, without rebuilding', async () => {
  const run = fixture();
  const complete = run.services.authority.complete;
  run.services.authority.complete = async () => { throw new Error('Receipt delivery unavailable'); };

  await expect(publishVisitorBaseline(resetId, run.services)).rejects.toThrow('delivery');
  run.services.authority.complete = complete;
  const result = await publishVisitorBaseline(resetId, run.services);
  expect(result.commit).toBe('b'.repeat(40));
  expect(run.events.filter(event => event === 'build')).toHaveLength(1);
  expect(run.events.filter(event => event === 'append')).toHaveLength(1);
  expect(run.reserved).toBeLessThanOrEqual(0.05);
});

it('rejects a stale canonical revision on checkpoint replay without new publication', async () => {
  const run = fixture();
  await publishVisitorBaseline(resetId, run.services);
  run.clearSaved(); run.setHead('c'.repeat(40));
  const count = run.events.filter(event => event.startsWith('upload:')).length;
  await expect(publishVisitorBaseline(resetId, run.services)).rejects.toThrow('revision changed');
  expect(run.events.filter(event => event.startsWith('upload:'))).toHaveLength(count);
});

it('compiles the fixed minimal source and executes the actual platform starter tests without credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arti-platform-baseline-'));

  try {
    await mkdir(join(directory, 'tests'));
    await writeFile(join(directory, 'worker.ts'), helloWorldWorker);
    await writeFile(join(directory, 'tests/worker.test.mjs'), helloWorldTests);
    const execute = promisify(execFile);
    await execute(process.execPath, [join(process.cwd(), 'node_modules/typescript/bin/tsc'), join(directory, 'worker.ts'), '--ignoreConfig', '--target', 'ES2023', '--module', 'ESNext', '--skipLibCheck', '--outDir', join(directory, 'tests/output')]);
    await execute(process.execPath, ['--test', join(directory, 'tests/worker.test.mjs')]);
    expect(await helloWorldBaselineHash()).toMatch(/^[a-f0-9]{64}$/);
    await expect(verifyHelloWorldResponse(new Response('x'.repeat(9000), { headers: { 'Content-Type': 'text/html' } }))).rejects.toThrow('limit');
  } finally { await rm(directory, { recursive: true, force: true }); }
});


it('releases a misconfigured fixed-target lease without touching Git, build or provider upload', async () => {
  const run = fixture();
  run.services.authority.authorize = async () => ({ projectId: 'collective', repository: 'unexpected-repository', deployment: null });
  await expect(publishVisitorBaseline(resetId, run.services)).rejects.toThrow('fixed shared project');
  expect(run.events).toEqual(['release']);
  expect(run.reserved).toBe(0);
});
