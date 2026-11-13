import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ApiService } from '../../api-service';
import { WorldEngine, createInitialState } from '../../../packages/domain/src/index';
import { LocalGlmRunner } from './runner';
import { localGlmConfiguration } from './configuration';
import { reservationFor, type LocalModelInput } from './provider';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function setup(cap = 1) {
  const folder = await mkdtemp(join(tmpdir(), 'arti-local-glm-'));
  const service = new ApiService(folder, cap);
  await service.initialize();
  cleanups.push(async () => { service.close(); await rm(folder, { recursive: true, force: true }); });

  return service;
}

async function goal(service: ApiService, approve = true) {
  await service.command({ role: 'operator' }, { type: 'goal.create', objective: 'PRIVATE-OBJECTIVE-CANARY', criteria: ['PRIVATE-CRITERION-CANARY'], constraints: ['PRIVATE-CONSTRAINT-CANARY'] }, 'local-create-goal');
  const id = service.getState().goals[0].id;

  if (approve) await service.command({ role: 'operator' }, { type: 'goal.public_brief', goalId: id, expectedRevision: 1, text: 'Create a public workshop website with a useful team introduction.', acknowledgement: 'APPROVE_PUBLIC_AUTHORING' }, 'local-approve-brief');
  await service.command({ role: 'operator' }, { type: 'goal.start', goalId: id }, 'local-start-goal');

  return id;
}

const html = '<!doctype html><html lang="en"><head><title>Workshop</title><style>body{color:#123}</style></head><body><main><h1>Public workshop</h1><p>A team building useful things together.</p></main></body></html>';

it('requires explicit activation and a bounded allowance; restored metadata grants no paid authority', () => {
  expect(localGlmConfiguration.safeParse({ accountId: 'a'.repeat(32), dailyUsd: 1 }).success).toBe(false);
  expect(localGlmConfiguration.safeParse({ accountId: 'a'.repeat(32), dailyUsd: 2, activation: 'ENABLE_PAID_LOCAL_GLM' }).success).toBe(false);
  const local = new WorldEngine(createInitialState(), true);
  local.configureLocalInference(1);
  const restored = new WorldEngine(local.getState());
  expect(restored.getState().localInference).toBeUndefined();
  expect(() => restored.reserveBudget('builder-1', 0.01, 'restored-spend')).toThrow();
  expect(() => local.dispatch({ role: 'operator' }, { type: 'world.tick' }, 'scripted-tick')).toThrow('Simulation ticks');
});

it('runs actual adapter outputs through local commits and structural checks, leaving criteria and acceptance to the human', async () => {
  const service = await setup();
  const id = await goal(service);
  const inputs: LocalModelInput[] = [];

  const runner = new LocalGlmRunner(service, async input => {
    inputs.push(input);
    expect(service.getState().budget.reservedUsd).toBeGreaterThan(0);

    return { content: JSON.stringify({ html, body: `I suggest this workshop layout for contribution ${inputs.length}.` }), usage: { prompt_tokens: 100, completion_tokens: 100 } };
  });

  for (let index = 0; index < 8; index++) await runner.step();
  const state = service.getState();
  expect(state.localInference?.status).toBe('ready');
  expect(inputs).toHaveLength(8);
  expect(JSON.stringify(inputs)).not.toContain('PRIVATE-');
  expect(state.tasks.every(task => task.status === 'verified')).toBe(true);
  expect(state.goals[0].status).toBe('active');
  expect(state.discussions.filter(post => post.visibility === 'public').every(post => post.origin === 'agent')).toBe(true);
  expect(state.deployments.at(-1)).toMatchObject({ authorship: 'agent', environment: 'simulation' });
  expect(state.evidence.every(run => run.criterion !== 'PRIVATE-CRITERION-CANARY')).toBe(true);
  expect((await service.execution.site('collective')).html).toBe(html);
  expect(() => new WorldEngine(state, true).dispatch({ role: 'operator' }, { type: 'goal.control', goalId: id, expectedRevision: 1, action: 'accept', feedback: '' }, 'premature-accept')).toThrow();
  await service.command({ role: 'operator' }, { type: 'goal.verify', goalId: id, expectedRevision: 1, criterionIndex: 0, deploymentId: state.deployments.at(-1)!.id, assertions: ['I inspected the local website result'] }, 'human-local-verify');
  expect(service.getState().goals[0].status).toBe('awaiting_acceptance');
  await service.command({ role: 'operator' }, { type: 'goal.control', goalId: id, expectedRevision: 1, action: 'accept', feedback: '' }, 'human-local-accept');
  expect(service.getState().goals[0].status).toBe('completed');
});

it('does not dispatch on an unapproved private target or exhausted allowance', async () => {
  const service = await setup(0.000001);
  let calls = 0;

  const runner = new LocalGlmRunner(service, async () => { calls++;

    return { content: '{"body":"A useful suggestion."}' }; });

  await runner.step();
  expect(calls).toBe(0);
  expect(service.getState().localInference?.status).toBe('blocked');
  await service.localMutation(engine => engine.localStatus('ready'));
  await goal(service, false);
  await runner.step();
  expect(calls).toBe(0);
});

it('fences a changed goal after paid inference and retains unknown cost without publishing', async () => {
  const service = await setup();
  const id = await goal(service);

  const runner = new LocalGlmRunner(service, async () => {
    await service.command({ role: 'operator' }, { type: 'goal.control', goalId: id, expectedRevision: 1, action: 'cancel', feedback: '' }, 'cancel-during-infer');

    return { content: JSON.stringify({ html, body: 'A proposed layout.' }) };
  });

  await runner.step();
  expect(service.getState().budget.reservedUsd).toBeGreaterThan(0);
  expect(service.getState().deployments).toHaveLength(1);
  expect(service.getState().discussions).toHaveLength(0);
});

it('retains failed dispatch reservations and hides provider error material', async () => {
  const service = await setup();
  const runner = new LocalGlmRunner(service, async () => { throw new Error('PRIVATE-TOKEN-CANARY'); });
  await runner.step();
  expect(service.getState().budget.reservedUsd).toBeGreaterThan(0);
  expect(service.getState().localInference).toMatchObject({ status: 'blocked', error: 'LOCAL_GLM_ACTION_FAILED' });
  expect(JSON.stringify(service.getPublicState())).not.toContain('CANARY');
  expect(() => reservationFor({ instructions: 'x'.repeat(80_001), context: '', code: true })).toThrow('CONTEXT_LIMIT');
});


it('blocks automatic preview navigation and keeps failed generated code out of canonical history', async () => {
  const service = await setup();
  await goal(service);
  const prior = service.getState().deployments[0].commit;
  const runner = new LocalGlmRunner(service, async () => ({ content: JSON.stringify({ html: html.replace('<title>', '<meta http-equiv="refresh" content="0;url=https://example.com"><title>'), body: 'A proposed layout.' }), usage: { prompt_tokens: 10, completion_tokens: 10 } }));
  await runner.step();
  expect(service.getState().localInference?.status).toBe('blocked');
  expect(service.getState().deployments).toHaveLength(1);
  expect(await service.execution.repositories.head(service.execution.repositories.path('collective'))).toBe(prior);
});

it('preserves failed-call reservations across restarts and keeps simulation restart paid-disabled', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'arti-local-restart-'));
  let service = new ApiService(folder, 1);

  try {
    await service.initialize();
    const runner = new LocalGlmRunner(service, async () => { throw new Error('Disconnected'); });
    await runner.step();
    const reserved = service.getState().budget.reservedUsd;
    service.close();
    service = new ApiService(folder, 1);
    await service.initialize();
    expect(service.getState().budget.reservedUsd).toBe(reserved);
    service.close();
    service = new ApiService(folder);
    await service.initialize();
    expect(service.getState().localInference).toBeUndefined();
    expect(service.getState().budget.reservedUsd).toBe(reserved);
  } finally { service.close(); await rm(folder, { recursive: true, force: true }); }
});
