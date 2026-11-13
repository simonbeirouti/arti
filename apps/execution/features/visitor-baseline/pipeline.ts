import { z } from 'zod';
import type { Deployment } from '../../../../packages/contracts/src/index';
import { LiveGate, type AllowanceAuthority, type WorkerBundle } from '../../../../packages/provider-adapters/src/cloudflare';
import type { BuildOutput } from '../cloud-build/sandbox';
import { helloWorldBaselineHash, verifyHelloWorldResponse } from './content';

export interface BaselineAuthority {
  authorize(resetId: string, attemptId: string): Promise<{ projectId: string; repository: string; deployment: Deployment | null }>;
  reserve(resetId: string, attemptId: string, amount: number, operation: string): Promise<{ id: string }>;
  settle(id: string, actualUsd: number | null): Promise<void>;
  complete(resetId: string, attemptId: string, deployment: Deployment, baselineHash: string, assertions: string[]): Promise<void>;
  release(resetId: string, attemptId: string): Promise<void>;
}

const checkpointSchema = z.object({ baselineHash: z.string().regex(/^[a-f0-9]{64}$/), commit: z.string().regex(/^[a-f0-9]{40}$/), bundleHash: z.string().regex(/^[a-f0-9]{64}$/), assertions: z.array(z.string()).min(3).max(20) }).strict();

type BaselineCheckpoint = z.infer<typeof checkpointSchema>;

export interface BaselineServices {
  authority: BaselineAuthority;
  checkpoint(resetId: string): Promise<string | null>;
  saveCheckpoint(resetId: string, checkpoint: BaselineCheckpoint): Promise<void>;
  canonicalHead(repository: string): Promise<string>;
  matchesSource(repository: string, commit: string): Promise<boolean>;
  appendSource(repository: string, expectedHead: string, resetId: string): Promise<string>;
  build(): Promise<BuildOutput>;
  saveBundle(hash: string, output: BuildOutput, resetId: string): Promise<void>;
  readBundle(hash: string): Promise<string>;
  upload(environment: 'staging' | 'production', bundle: WorkerBundle, name: string, gate: Pick<LiveGate, 'run'>): Promise<void>;
  smoke(environment: 'staging' | 'production', name: string): Promise<Response>;
}

async function digest(content: string): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))), byte => byte.toString(16).padStart(2, '0')).join(''); }

/** Owner reset permits one fixed checked baseline, with neither agent actor nor model invocation. */
export async function publishVisitorBaseline(resetId: string, services: BaselineServices): Promise<Deployment> {
  z.uuid().parse(resetId);
  const attemptId = crypto.randomUUID();
  const { authority } = services;
  const scope = await authority.authorize(resetId, attemptId);

  if (scope.projectId !== 'collective' || scope.repository !== 'collective') {
    await authority.release(resetId, attemptId).catch(() => undefined);
    throw new Error('Platform baseline target differs from fixed shared project');
  }

  if (scope.deployment) {
    if (scope.deployment.authorship !== 'platform' || scope.deployment.projectId !== 'collective' || scope.deployment.version !== 1) throw new Error('Invalid saved platform baseline');

    return scope.deployment;
  }

  const allowance: AllowanceAuthority = {
    reserve: async (_identity, amount, operation) => authority.reserve(resetId, attemptId, amount, operation),
    settle: (id, actual) => authority.settle(id, actual),
  };

  const gate = new LiveGate({ activated: true, dailyAllowanceUsd: 0.05 }, allowance);
  const check = async () => { await authority.authorize(resetId, attemptId); };

  try {
    const baselineHash = await helloWorldBaselineHash();
    const saved = await services.checkpoint(resetId);
    let checkpoint = saved ? checkpointSchema.parse(JSON.parse(saved)) : null;

    if (checkpoint && checkpoint.baselineHash !== baselineHash) throw new Error('Baseline source changed after reset');
    const head = await gate.run('platform-bootstrap', 0.002, 'baseline.head', () => services.canonicalHead(scope.repository));
    z.string().regex(/^[a-f0-9]{40}$/).parse(head);
    let compiled: string;

    if (checkpoint) {
      if (head !== checkpoint.commit || !await services.matchesSource(scope.repository, head)) throw new Error('Saved baseline canonical revision changed');
      compiled = await services.readBundle(checkpoint.bundleHash);

      if (await digest(compiled) !== checkpoint.bundleHash) throw new Error('Retained baseline bundle mismatch');
    } else {
      await check();
      const commit = await services.matchesSource(scope.repository, head) ? head : await gate.run('platform-bootstrap', 0.005, 'baseline.git', () => services.appendSource(scope.repository, head, resetId));
      z.string().regex(/^[a-f0-9]{40}$/).parse(commit);

      if (!await services.matchesSource(scope.repository, commit)) throw new Error('Committed platform baseline source mismatch');
      await check();
      const output = await gate.run('platform-bootstrap', 0.02, 'baseline.build', () => services.build());

      if (!['TypeScript compiled', 'Agent tests passed', 'Independent HTTP smoke passed'].every(assertion => output.assertions.includes(assertion))) throw new Error('Platform baseline checked build evidence missing');
      compiled = output.compiled;
      const bundleHash = await digest(compiled);
      await services.saveBundle(bundleHash, output, resetId);
      checkpoint = { baselineHash, commit, bundleHash, assertions: ['Platform-provided Hello World baseline', 'TypeScript compiled', 'Platform baseline tests passed', 'Independent HTTP smoke passed'] };
      await services.saveCheckpoint(resetId, checkpoint);
    }

    const name = `collective-${checkpoint.bundleHash}`;
    const bundle: WorkerBundle = { mainModule: 'index.js', modules: [{ name: 'index.js', content: compiled, type: 'application/javascript+module' }] };
    await check();
    await services.upload('staging', bundle, name, gate);
    await gate.run('platform-bootstrap', 0.001, 'baseline.staging-smoke', async () => verifyHelloWorldResponse(await services.smoke('staging', name)));
    await check();
    const finalHead = await gate.run('platform-bootstrap', 0.002, 'baseline.final-head', () => services.canonicalHead(scope.repository));

    if (finalHead !== checkpoint.commit) throw new Error('Baseline canonical revision changed before publication');
    await services.upload('production', bundle, name, gate);
    await gate.run('platform-bootstrap', 0.001, 'baseline.production-smoke', async () => verifyHelloWorldResponse(await services.smoke('production', name)));
    await check();
    const deployment: Deployment = { id: `deployment-platform-baseline-${resetId}`, projectId: 'collective', entityId: 'steward', authorship: 'platform', commit: checkpoint.commit, version: 1, environment: 'production', status: 'published', createdAt: new Date().toISOString(), bundleHash: checkpoint.bundleHash, workerName: name };
    await authority.complete(resetId, attemptId, deployment, baselineHash, [...checkpoint.assertions, 'Staging Hello World HTTP verified', 'Production Hello World HTTP verified']);

    return deployment;
  } finally { await authority.release(resetId, attemptId).catch(() => undefined); }
}
