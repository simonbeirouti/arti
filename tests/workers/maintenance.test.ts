/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { MaintenanceLedger } from '../../apps/world/features/operations/maintenance';
import { WorldEngine } from '../../packages/domain/src/index';

it('rejects maintenance without positive subset allowance and retains explicitly supplied commitments', async () => {
  const world = env.WORLD.getByName('maintenance-ledger');

  const result = await runInDurableObject(world, (_instance, state) => {
    const ledger = new MaintenanceLedger(state.storage.sql);
    let zero = false;

    try { ledger.reserve('first', 'researcher', 0.01, 0, 0); } catch { zero = true; }

    ledger.reserve('first', 'researcher', 0.01, 0.01, 0);
    let replay = false;

    try { ledger.reserve('first', 'researcher', 0.01, 0.02, 0.01); } catch { replay = true; }

    let exhausted = false;

    try { ledger.reserve('next-day', 'researcher', 0.01, 0.01, 0.01); } catch { exhausted = true; }

    return { zero, replay, exhausted };
  });

  expect(result).toEqual({ zero: true, replay: true, exhausted: true });
});

it('preserves current live reservations and operator limits when restoring older world state', async () => {
  const world = env.WORLD.getByName('maintenance-restore-ledger');
  const current = new WorldEngine().getState();
  current.mode = 'live'; current.paused = true; current.clock = new Date().toISOString(); current.budget.dailyUsd = 1;

  for (const entity of current.entities) entity.dailyAllowanceUsd = 0.5;
  const engine = new WorldEngine(current);
  engine.reserveBudget('researcher', 0.2, 'maintenance-already-spent', true);
  await runInDurableObject(world, (_instance, state) => {
    state.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_snapshot(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
    state.storage.sql.exec('INSERT INTO world_snapshot(id,value) VALUES(1,?)', JSON.stringify(engine.getState()));
  });
  const older = new WorldEngine().getState(); older.mode = 'live'; older.paused = true; older.budget.dailyUsd = 100;

  for (const entity of older.entities) entity.dailyAllowanceUsd = 100;
  const restored = await world.restoreBackup(JSON.stringify(older));
  expect(restored.budget.dailyUsd).toBe(1);
  expect(restored.budget.reservedUsd).toBe(0.2);
  expect(restored.reservations.some(item => item.id === 'maintenance-already-spent')).toBe(true);
  expect(restored.entities.find(entity => entity.id === 'researcher')?.dailyAllowanceUsd).toBe(0.5);
});


it('authorizes retained backup reads only behind the matching paused barrier and charges every new dispatch', async () => {
  const world = env.WORLD.getByName('backup-retained-read');
  await runInDurableObject(world, (_instance, context) => {
    const state = new WorldEngine().getState();
    state.mode = 'live'; state.paused = true;
    state.budget.dailyUsd = 5;
    state.projects![0].siteVersion = 1;

    for (const entity of state.entities) entity.dailyAllowanceUsd = 1;
    context.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_snapshot(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
    context.storage.sql.exec('INSERT INTO world_snapshot(id,value) VALUES(1,?)', JSON.stringify(state));
    context.storage.sql.exec('CREATE TABLE IF NOT EXISTS backup_barrier(id INTEGER PRIMARY KEY,backup TEXT NOT NULL,resume INTEGER NOT NULL)');
    context.storage.sql.exec('INSERT INTO backup_barrier(id,backup,resume) VALUES(1,?,0)', 'backup-test');
  });

  const denied = await runInDurableObject(world, instance => {
    let wrongBarrier = false; let unknownEntity = false;

    try { instance.authorizeBackupExport('collective', 'wrong-backup', false); } catch { wrongBarrier = true; }

    try { instance.authorizeBackupExport('unknown-entity', 'backup-test', false); } catch { unknownEntity = true; }

    return { wrongBarrier, unknownEntity };
  });

  expect(denied).toEqual({ wrongBarrier: true, unknownEntity: true });
  await world.authorizeBackupExport('collective', 'backup-test', false);
  await world.authorizeBackupExport('collective', 'backup-test', false);
  expect((await world.inspect()).budget.reservedUsd).toBe(0);
  await world.authorizeBackupExport('collective', 'backup-test', true);
  await world.authorizeBackupExport('collective', 'backup-test', true);
  expect((await world.inspect()).budget.reservedUsd).toBeCloseTo(0.02);
  await runInDurableObject(world, (_instance, context) => { context.storage.sql.exec('DELETE FROM backup_barrier WHERE id=1'); });
  expect(await runInDurableObject(world, instance => {
    try { instance.authorizeBackupExport('collective', 'backup-test', false);

 return false; } catch { return true; }
  })).toBe(true);
});
