/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { createInitialState } from '../../packages/domain/src/index';
import { EvaluationLedger } from '../../apps/world/features/model-evaluations/ledger';
import { releaseFingerprint } from '../../apps/world/generated/release';

it('includes today evaluation holds in the world cap while preserving yesterday liabilities separately', async () => {
  const world = env.WORLD.getByName('daily-evaluation-budget');
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  await runInDurableObject(world, (instance, context) => {
    const ledger = new EvaluationLedger(context.storage.sql);
    ledger.begin('b5190033-e240-4edf-b0e0-20623c9571fa', 0.1, { enabled: true, dailyUsd: 0.75, environment: 'test-evaluation-budget' }, yesterday);
    const state = instance.inspect(); state.budget.dailyUsd = 0.1;
    context.storage.sql.exec('INSERT INTO world_snapshot(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', JSON.stringify(state));
  });
  const old = await world.inspect();
  expect(old.budget.reservedUsd).toBe(0);
  expect(old.budget.outstandingReservedUsd).toBeCloseTo(0.1);
  await world.beginEvaluation('b5190033-e240-4edf-b0e0-20623c9571fb', 0.1, releaseFingerprint);
  expect((await world.inspect()).budget).toMatchObject({ reservedUsd: 0.1, outstandingReservedUsd: 0.2 });

  const rejected = await runInDurableObject(world, async instance => {
    try { await instance.beginEvaluation('b5190033-e240-4edf-b0e0-20623c9571fc', 0.1, releaseFingerprint);

      return false; } catch { return true; }
  });

  expect(rejected).toBe(true);
});

it('cannot continue a prior-day evaluation with new model dispatch or build authorization', async () => {
  const world = env.WORLD.getByName('daily-evaluation-continuation');

  const result = await runInDurableObject(world, (_instance, context) => {
    const ledger = new EvaluationLedger(context.storage.sql);
    const id = 'c5190033-e240-4edf-b0e0-20623c9571fa';

    const yesterday = new Date(Date.now() - 86400000).toISOString();
    ledger.begin(id, 0.1, { enabled: true, dailyUsd: 1, environment: 'test-evaluation-budget' }, yesterday);
    ledger.reserve(id, 'coding-build', 0.01, yesterday);
    let modelDenied = false; let buildDenied = false;

    try { ledger.reserve(id, 'new-model', 0.01); } catch { modelDenied = true; }

    try { ledger.authorize(id, 'coding-build'); } catch { buildDenied = true; }

    return { modelDenied, buildDenied, run: ledger.get(id) };
  });

  expect(result.modelDenied).toBe(true);
  expect(result.buildDenied).toBe(true);
  expect(result.run).toMatchObject({ status: 'running', allowanceUsd: 0.1, reservedUsd: 0.1 });
});

it('applies maintenance subset caps by original dispatch day without dropping historical holds', async () => {
  const world = env.WORLD.getByName('daily-maintenance-budget');
  await runInDurableObject(world, (_instance, context) => {
    const state = createInitialState(); state.mode = 'live'; state.paused = true; state.clock = new Date().toISOString();
    state.projects![0].siteVersion = 1; state.budget.dailyUsd = 5;

    for (const entity of state.entities) entity.dailyAllowanceUsd = 0.75;
    state.reservations.push({ id: 'maintenance-yesterday', entityId: 'steward', estimatedUsd: 0.5, actualUsd: null, status: 'reserved', createdAt: new Date(Date.now() - 86400000).toISOString() });
    state.budget.reservedUsd = 0.5;
    context.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_snapshot(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
    context.storage.sql.exec('INSERT INTO world_snapshot(id,value) VALUES(1,?)', JSON.stringify(state));
    context.storage.sql.exec('CREATE TABLE IF NOT EXISTS backup_barrier(id INTEGER PRIMARY KEY,backup TEXT NOT NULL,resume INTEGER NOT NULL)');
    context.storage.sql.exec('INSERT INTO backup_barrier(id,backup,resume) VALUES(1,?,0)', 'daily-backup');
  });
  await world.authorizeBackupExport('collective', 'daily-backup', true);
  const state = await world.inspect();
  expect(state.budget.reservedUsd).toBeCloseTo(0.01);
  expect(state.budget.outstandingReservedUsd).toBeCloseTo(0.51);
  expect((await world.operations()).reservedUsd).toBeCloseTo(0.51);
  expect(state.reservations.find(item => item.id === 'maintenance-yesterday')?.status).toBe('reserved');
});

it('retains current caps, merged reservation history and conservative residuals across repeated restore', async () => {
  const world = env.WORLD.getByName('daily-restore-budget');
  const now = new Date().toISOString(); const yesterday = new Date(Date.now() - 86400000).toISOString();
  const current = createInitialState(); current.mode = 'live'; current.paused = true; current.clock = now; current.budget.dailyUsd = 5;
  current.reservations = [{ id: 'current-hold', entityId: 'researcher', estimatedUsd: 0.2, actualUsd: null, status: 'reserved', createdAt: now }];
  current.budget.reservedUsd = 0.3;
  await runInDurableObject(world, (_instance, context) => {
    context.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_snapshot(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
    context.storage.sql.exec('INSERT INTO world_snapshot(id,value) VALUES(1,?)', JSON.stringify(current));
  });
  const backup = createInitialState(); backup.mode = 'live'; backup.paused = true; backup.clock = yesterday; backup.budget.dailyUsd = 100;
  backup.reservations = [{ id: 'historical-hold', entityId: 'builder-1', estimatedUsd: 0.1, actualUsd: null, status: 'reserved', createdAt: yesterday }];
  backup.budget.reservedUsd = 0.3;
  const first = await world.restoreBackup(JSON.stringify(backup));
  expect(first.budget.dailyUsd).toBe(5);
  expect(first.budget.reservedUsd).toBeCloseTo(0.4);
  expect(first.budget.outstandingReservedUsd).toBeCloseTo(0.5);
  expect(first.reservations).toHaveLength(2);
  const replay = await world.restoreBackup(JSON.stringify(backup));
  expect(replay.budget).toEqual(first.budget);
  expect(replay.reservations).toEqual(first.reservations);
});

it('preserves evaluation liability and current cap when restoring a simulated world', async () => {
  const world = env.WORLD.getByName('daily-simulation-restore');
  const now = new Date().toISOString();
  await runInDurableObject(world, (_instance, context) => {
    const current = createInitialState(); current.paused = true; current.clock = now; current.budget.dailyUsd = 1;
    current.reservations = [{ id: 'platform-evaluation:simulated-world-cost', entityId: 'platform-evaluation', estimatedUsd: 0.1, actualUsd: null, status: 'reserved', createdAt: now }];
    current.budget.reservedUsd = 0.1;
    context.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_snapshot(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
    context.storage.sql.exec('INSERT INTO world_snapshot(id,value) VALUES(1,?)', JSON.stringify(current));
  });
  const backup = createInitialState(); backup.paused = true; backup.clock = now;
  const restored = await world.restoreBackup(JSON.stringify(backup));
  expect(restored.mode).toBe('simulation');
  expect(restored.budget).toMatchObject({ dailyUsd: 1, reservedUsd: 0.1, outstandingReservedUsd: 0.1 });
  expect(restored.reservations[0]).toMatchObject({ status: 'reserved', actualUsd: null });
});
