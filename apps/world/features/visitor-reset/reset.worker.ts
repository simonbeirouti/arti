import { freshSlice } from '../../../../apps/agent-runtime/features/agent-turns/slices';
import { releaseFingerprint } from '../../../../apps/world/generated/release';
import type { WorldDurableObject } from '../../../../apps/world/src/index';
/// <reference types="@cloudflare/vitest-plugin/types" />
import { getAgentByName } from 'agents';
import { env } from 'cloudflare:workers';
import { runInDurableObject, reset, abortAllDurableObjects } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import { SharedResetLedger } from '../../../../apps/world/features/visitor-reset/ledger';
import { EvaluationLedger } from '../../../../apps/world/features/model-evaluations/ledger';
import { helloWorldBaselineHash } from '../../../../apps/execution/features/visitor-baseline/content';
import { LiveGate } from '../../../../packages/provider-adapters/src/cloudflare';
import type { Deployment } from '../../../../packages/contracts/src/index';

const resetId = 'de120033-e240-4edf-b0e0-20623c9571fa';

const attemptId = 'de120033-e240-4edf-b0e0-20623c9571fb';

const approvalId = 'de120033-e240-4edf-b0e0-20623c9571fc';

beforeEach(async () => {
  await reset(); await abortAllDurableObjects();
  const objects = await env.WORLD_BACKUPS?.list({ prefix: 'private-shared-resets/' });

  if (objects && env.WORLD_BACKUPS) for (const object of objects.objects) await env.WORLD_BACKUPS.delete(object.key);
});

async function rejection(world: ReturnType<typeof env.WORLD.getByName>, operation: (instance: WorldDurableObject) => Promise<void> | void): Promise<string> {
  return runInDurableObject(world, async instance => {
    try { await operation(instance);

      return ''; } catch (error) { return error instanceof Error ? error.message : 'Rejected'; }
  });
}

async function prepared(name: string) {
  await env.WORLD.getByName('arti-world').command({ role: 'operator' }, { type: 'world.pause', paused: true }, `${name}-canonical-pause`);
  const world = env.WORLD.getByName(name);
  await world.command({ role: 'operator' }, { type: 'world.pause', paused: true }, `${name}-pause`);
  await runInDurableObject(world, (instance, context) => {
    const state = instance.inspect(); state.mode = 'live'; state.budget.dailyUsd = 5;
    context.storage.sql.exec('UPDATE world_snapshot SET value=? WHERE id=1', JSON.stringify(state));
    const ledger = new EvaluationLedger(context.storage.sql);
    ledger.begin(approvalId, 0.1, { enabled: true, dailyUsd: 1, environment: 'test-evaluation-budget' }, new Date().toISOString());
    ledger.finish(approvalId, ['tool-followup', 'private-data-policy', 'coding-build', 'scoped-structured-arguments'].map(id => ({ id, passed: true, assertions: ['Local approval fixture; no provider evaluation performed'] })));
  });

  return world;
}

async function clearWork(world: ReturnType<typeof env.WORLD.getByName>) {
  if (!env.ENTITY_AGENT || !env.WORLD_BACKUPS) throw new Error('Reset test bindings required');
  const entities = (await world.inspect()).entities;

  for (const [index, entity] of entities.entries()) {
    await world.authorizeResetEntity(resetId, entity.id);
    const agent = await getAgentByName(env.ENTITY_AGENT, entity.id);
    const original = await agent.exportPrivateState();
    const key = `private-shared-resets/${resetId}/entities/${entity.id}.json`;
    const source = JSON.stringify(original);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))), byte => byte.toString(16).padStart(2, '0')).join('');
    await env.WORLD_BACKUPS.put(key, source);
    await agent.importPrivateState({ ...original, state: { ...original.state, running: false, leaseUntil: 0, turnId: null, checkpoint: 0, continuation: null, pendingCommand: null, governancePending: null } });
    await world.confirmSharedWorkReset(resetId, [{ entityId: entity.id, key, sha256 }]);
    const receipt = await world.resetSharedWebsite(resetId, 'RESET_SHARED_WEBSITE');
    expect(receipt.entityArchives).toHaveLength(index + 1);
    expect(receipt.workCleared).toBe(index === entities.length - 1);
  }
}

it('archives before clearing, keeps session identities and bills, and fences intake until baseline publication', async () => {
  const world = await prepared('shared-reset-archive');
  await world.onboardVisitor('shared-visitor-token', 'Avery', 'reset-ip');
  await world.submitVisitorSuggestion('shared-visitor-token', 'Build a useful public calendar', 'initial-suggestion', 'reset-ip');
  const before = await world.inspect();
  const receipt = await world.resetSharedWebsite(resetId, 'RESET_SHARED_WEBSITE');
  expect(receipt.status).toBe('reset');
  const archived = await env.WORLD_BACKUPS?.get(receipt.archiveKey);

  if (!archived) throw new Error('Private archive missing');
  expect(JSON.parse(await archived.text()).world.visitorBuild.suggestions).toHaveLength(1);
  const after = await world.inspect();
  expect(after.visitorBuild?.suggestions).toEqual([]);
  expect(after.visitorBuild?.visitors).toEqual(before.visitorBuild?.visitors);
  expect(await world.visitorSession('shared-visitor-token')).toEqual({ id: before.visitorBuild!.visitors[0].id, name: 'Avery' });
  expect(after.budget.dailyUsd).toBe(5);
  expect(await rejection(world, async instance => { await instance.restoreCompleteBackup('invalid manifest must never be inspected'); })).toContain('Shared website reset is pending');
  expect(after.reservations.some(item => item.entityId === 'platform-bootstrap' && item.status === 'reserved' && item.actualUsd === null)).toBe(true);
  expect(await rejection(world, async instance => { await instance.submitVisitorSuggestion('shared-visitor-token', 'Build another useful calendar', 'blocked-suggestion', 'reset-ip'); })).toContain('pending');
  expect(await rejection(world, async instance => { await instance.command({ role: 'operator' }, { type: 'world.pause', paused: false }, 'blocked-resume'); })).toContain('pending');
  expect(await world.resetSharedWebsite(resetId, 'RESET_SHARED_WEBSITE')).toEqual(receipt);
  expect(await rejection(world, async instance => { await instance.resetSharedWebsite('de120033-e240-4edf-b0e0-20623c9571fd', 'RESET_SHARED_WEBSITE'); })).toContain('Another');
});

it('rejects unpaused or unacknowledged resets and canonical active publication leases', async () => {
  const world = await prepared('shared-reset-leases');
  expect(await rejection(world, async instance => { await instance.resetSharedWebsite(resetId, 'wrong'); })).toContain('Acknowledged');
  await world.command({ role: 'operator' }, { type: 'world.pause', paused: false }, 'reset-unpaused');
  expect(await rejection(world, async instance => { await instance.resetSharedWebsite(resetId, 'RESET_SHARED_WEBSITE'); })).toContain('Pause');
  await world.command({ role: 'operator' }, { type: 'world.pause', paused: true }, 'reset-repause');
  await runInDurableObject(world, (_instance, context) => {
    context.storage.sql.exec('CREATE TABLE IF NOT EXISTS publication_lease(entity TEXT PRIMARY KEY,owner TEXT NOT NULL,expiry INTEGER NOT NULL)');
    context.storage.sql.exec('INSERT INTO publication_lease(entity,owner,expiry) VALUES(?,?,?)', 'project:collective', 'active-build', Date.now() + 60000);
  });
  expect(await rejection(world, async instance => { await instance.resetSharedWebsite(resetId, 'RESET_SHARED_WEBSITE'); })).toContain('Publication');
  expect(await runInDurableObject(world, (_instance, context) => new SharedResetLedger(context.storage.sql).active())).toBeNull();
});

it('accepts a real LiveGate operation tag, fences concurrent attempts and publishes only the checked platform baseline', async () => {
  const world = await prepared('shared-reset-baseline');

  if (!env.ENTITY_AGENT) throw new Error('Entity test binding required');

  const staleAgent = await getAgentByName(env.ENTITY_AGENT, 'researcher');
  const slice = freshSlice(); slice.inFlight = { name: 'repo.patch_commit', arguments: 'PRIVATE obsolete delivery' };
  await staleAgent.importPrivateState({ entityId: 'researcher', state: { entries: ['memory:retained:PRIVATE entry'], running: false, turns: 3, leaseUntil: 0, checkpoint: 2, turnId: null, pendingCommand: null, governancePending: { command: { type: 'suggestion.select' }, key: 'visitor-governance-obsolete-key' }, continuation: { id: crypto.randomUUID(), release: releaseFingerprint, context: 'PRIVATE old scope', privateWork: true, instructions: 'PRIVATE old instructions', profile: { id: 'researcher', name: 'Sage', role: 'researcher', personality: [] }, personal: null, slice } } });
  expect((await staleAgent.recoveryStatus()).blocked).toBe(true);
  await world.resetSharedWebsite(resetId, 'RESET_SHARED_WEBSITE');
  expect(await rejection(world, async instance => { await instance.authorizeVisitorBaseline(resetId, attemptId); })).toContain('window');
  await clearWork(world);
  expect((await staleAgent.recoveryStatus()).blocked).toBe(false);
  expect((await staleAgent.exportPrivateState()).state.entries).toEqual(['memory:retained:PRIVATE entry']);
  expect((await staleAgent.exportPrivateState()).state.turns).toBe(3);
  expect((await world.authorizeVisitorBaseline(resetId, attemptId)).deployment).toBeNull();
  expect(await rejection(world, async instance => { await instance.authorizeVisitorBaseline(resetId, 'de120033-e240-4edf-b0e0-20623c9571fd'); })).toContain('occupied');
  const gate = new LiveGate({ activated: true, dailyAllowanceUsd: 0.05 }, { reserve: (_entity, amount, operation) => world.reserveVisitorBaseline(resetId, attemptId, amount, operation), settle: (id, actual) => world.settle(id, actual) });
  await expect(gate.run('platform-bootstrap', 0.002, 'baseline.head', async () => 'local checked head fixture')).resolves.toBe('local checked head fixture');
  expect(await rejection(world, async instance => { await instance.reserveVisitorBaseline(resetId, attemptId, 0.001, `arbitrary.command:${crypto.randomUUID()}`); })).not.toBe('');
  expect(await rejection(world, async instance => { await instance.reserveVisitorBaseline(resetId, attemptId, 0.05, `baseline.build:${crypto.randomUUID()}`); })).toContain('allowance');
  const bundleHash = 'b'.repeat(64);
  const deployment: Deployment = { id: `deployment-platform-baseline-${resetId}`, entityId: 'steward', projectId: 'collective', version: 1, authorship: 'platform', commit: 'a'.repeat(40), bundleHash, workerName: `collective-${bundleHash}`, status: 'published', environment: 'production', createdAt: new Date().toISOString() };
  const checks = ['Platform-provided Hello World baseline', 'TypeScript compiled', 'Platform baseline tests passed', 'Independent HTTP smoke passed', 'Staging Hello World HTTP verified', 'Production Hello World HTTP verified'];
  expect(await rejection(world, async instance => { await instance.completeVisitorBaseline(resetId, attemptId, deployment, await helloWorldBaselineHash(), ['Fake approval', 'fake test', 'fake smoke']); })).not.toBe('');
  await world.completeVisitorBaseline(resetId, attemptId, deployment, await helloWorldBaselineHash(), checks);
  const published = await world.inspect();
  expect(published.projects![0].siteVersion).toBe(1);
  expect(published.deployments).toEqual([deployment]);
  expect((await world.publicBuild()).events).toContainEqual(expect.objectContaining({ type: 'website.baseline', actorId: 'platform' }));
  await world.command({ role: 'operator' }, { type: 'world.pause', paused: false }, 'baseline-resume');
  expect((await world.authorizeVisitorBaseline(resetId, attemptId)).deployment).toEqual(deployment);
  await world.completeVisitorBaseline(resetId, attemptId, deployment, await helloWorldBaselineHash(), checks);
  expect((await world.inspect()).deployments).toHaveLength(1);
});
