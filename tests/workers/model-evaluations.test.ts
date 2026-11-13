import { releaseFingerprint } from '../../apps/world/generated/release';
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { EvaluationLedger } from '../../apps/world/features/model-evaluations/ledger';
import { createInitialState } from '../../packages/domain/src/index';

it('atomically shares evaluation reservations with the world cap, deduplicates replay and releases unused maximum on finish', async () => {
  const world = env.WORLD.getByName('evaluation-world-budget');
  await world.command({ role: 'operator' }, { type: 'budget.configure', dailyUsd: 0.15 }, 'configure-evaluation-world');
  await world.command({ role: 'operator' }, { type: 'world.pause', paused: true }, 'pause-evaluation-world');
  const firstId = 'a5190033-e240-4edf-b0e0-20623c9571fa';
  const nextId = 'a5190033-e240-4edf-b0e0-20623c9571fb';
  const first = await world.beginEvaluation(firstId, 0.1, releaseFingerprint);
  const replay = await world.beginEvaluation(firstId, 0.1, releaseFingerprint);
  expect(first.created).toBe(true);
  expect(replay.created).toBe(false);
  expect((await world.inspect()).budget.reservedUsd).toBeCloseTo(0.1);

  const rejected = await runInDurableObject(world, instance => {
    try { instance.beginEvaluation(nextId, 0.1, releaseFingerprint);

 return 'Unexpected reservation'; }
    catch (error) { return error instanceof Error ? error.message : ''; }
  });

  expect(rejected).toContain('World allowance exhausted');
  expect(await world.listEvaluations()).toHaveLength(1);
  await world.reserveEvaluation(firstId, 'model-0', 0.01);
  await world.finishEvaluation(firstId, []);
  expect((await world.inspect()).budget.reservedUsd).toBeCloseTo(0.01);
  await world.beginEvaluation(nextId, 0.1, releaseFingerprint);
  const state = await world.inspect();
  expect(state.budget.reservedUsd).toBeCloseTo(0.11);
  expect(state.paused).toBe(true);
  expect(state.entities.every(entity => entity.dailyAllowanceUsd === 0)).toBe(true);
});

it('rolls back a newly inserted evaluation if atomic world accounting rejects its reservation identity', async () => {
  const world = env.WORLD.getByName('evaluation-accounting-rollback');

  const result = await runInDurableObject(world, (instance, storage) => {
    const state = createInitialState();
    const id = 'a5190033-e240-4edf-b0e0-20623c9571fc';
    state.budget.dailyUsd = 5;
    state.budget.reservedUsd = 0.01;
    state.reservations.push({ id: `platform-evaluation:${id}`, entityId: 'researcher', estimatedUsd: 0.01, actualUsd: null, status: 'reserved', createdAt: state.clock });
    storage.storage.sql.exec('CREATE TABLE IF NOT EXISTS world_snapshot (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
    storage.storage.sql.exec('INSERT INTO world_snapshot(id,value) VALUES(1,?)', JSON.stringify(state));
    let failure = '';

    try { instance.beginEvaluation(id, 0.1, releaseFingerprint); }
    catch (error) { failure = error instanceof Error ? error.message : ''; }

    return { failure, runs: new EvaluationLedger(storage.storage.sql).listAll(), reservedUsd: instance.inspect().budget.reservedUsd };
  });

  expect(result.failure).toBe('Evaluation reservation identity conflict');
  expect(result.runs).toEqual([]);
  expect(result.reservedUsd).toBeCloseTo(0.01);
});

it('includes all legacy evaluation commitments beyond the fifty-receipt display limit', async () => {
  const world = env.WORLD.getByName('evaluation-legacy-accounting');

  const result = await runInDurableObject(world, (instance, storage) => {
    const ledger = new EvaluationLedger(storage.storage.sql);
    const now = new Date().toISOString();

    for (let index = 0; index < 60; index++) {
      const id = crypto.randomUUID();
      ledger.begin(id, 0.1, { enabled: true, dailyUsd: 100, environment: 'legacy' }, now);
      ledger.reserve(id, 'model-0', 0.01);
      ledger.finish(id, []);
    }

    const state = instance.command({ role: 'operator' }, { type: 'budget.configure', dailyUsd: 0.65 }, 'configure-legacy-evaluation-world');
    let failure = '';

    try { instance.beginEvaluation('a5190033-e240-4edf-b0e0-20623c9571fd', 0.1, releaseFingerprint); }
    catch (error) { failure = error instanceof Error ? error.message : ''; }

    return { displayed: ledger.list().length, all: ledger.listAll().length, reservations: state.reservations.length, reservedUsd: state.budget.reservedUsd, failure };
  });

  expect(result.displayed).toBe(50);
  expect(result.all).toBe(60);
  expect(result.reservations).toBe(60);
  expect(result.reservedUsd).toBeCloseTo(0.6);
  expect(result.failure).toBe('World allowance exhausted; evaluation not dispatched');
});

it('diagnoses rejected evaluation configuration without storing a run or exposing configuration values', async () => {
  const world = env.WORLD.getByName('evaluation-diagnostics');

  const result = await runInDurableObject(world, async (_instance, state) => {
    const ledger = new EvaluationLedger(state.storage.sql);
    const failures: string[] = [];

    const configurations = [
      { enabled: false, dailyUsd: 0.5, environment: 'private-environment-canary' },
      { enabled: true, dailyUsd: 0, environment: 'private-environment-canary' },
      { enabled: true, dailyUsd: Number.NaN, environment: 'private-environment-canary' },
      { enabled: true, dailyUsd: 0.5, environment: '' },
    ];

    for (const configuration of configurations) {
      try { ledger.begin('f8d33782-ea85-4b21-a84b-c3c85ea578ba', 0.1, configuration, '2026-10-12T00:00:00.000Z'); }
      catch (error) { failures.push(error instanceof Error ? error.message : 'Unexpected rejection'); }
    }

    return { failures, runs: ledger.list() };
  });

  const prefix = 'Paid evaluation requires configured allowance and release fingerprint: ';
  expect(result.failures).toEqual([
    `${prefix}evaluations disabled`,
    `${prefix}allowance must be finite and positive`,
    `${prefix}allowance must be finite and positive`,
    `${prefix}environment missing`,
  ]);
  expect(result.runs).toEqual([]);
  expect(JSON.stringify(result)).not.toContain('private-environment-canary');
});

it('reserves paid evaluation allowance once, enforces daily caps and authorizes a build only once', async () => {
  const world = env.WORLD.getByName('evaluation-ledger');

  const result = await runInDurableObject(world, async (_instance, state) => {
    const ledger = new EvaluationLedger(state.storage.sql);
    const id = 'f8d33782-ea85-4b21-a84b-c3c85ea578bd';
    const configuration = { enabled: true, dailyUsd: 0.2, environment: 'staging' };
    const first = ledger.begin(id, 0.2, configuration, '2026-10-12T00:00:00.000Z');
    const repeated = ledger.begin(id, 0.2, configuration, '2026-10-12T00:00:00.000Z');
    let exhausted = false;

    try { ledger.begin('f8d33782-ea85-4b21-a84b-c3c85ea578be', 0.1, configuration, '2026-10-12T00:00:00.000Z'); } catch { exhausted = true; }

    ledger.reserve(id, 'coding-build', 0.05, '2026-10-12T00:00:00.000Z'); ledger.authorize(id, 'coding-build', '2026-10-12T00:00:00.000Z');
    let duplicate = false;

    try { ledger.authorize(id, 'coding-build', '2026-10-12T00:00:00.000Z'); } catch { duplicate = true; }

    return { created: first.created, replayCreated: repeated.created, exhausted, duplicate };
  });

  expect(result).toEqual({ created: true, replayCreated: false, exhausted: true, duplicate: true });
});

it('rejects failed, missing and stale release evaluation receipts for activation', async () => {
  const world = env.WORLD.getByName('evaluation-activation');

  const result = await runInDurableObject(world, async (_instance, state) => {
    const ledger = new EvaluationLedger(state.storage.sql);
    const id = 'f8d33782-ea85-4b21-a84b-c3c85ea578bf';
    ledger.begin(id, 0.2, { enabled: true, dailyUsd: 1, environment: 'staging' }, '2026-10-12T00:00:00.000Z');
    ledger.finish(id, [{ id: 'coding-build', passed: false, assertions: ['failed test'] }]);
    let failed = false;

    try { ledger.assertPassed(id, 'staging'); } catch { failed = true; }

    const run = ledger.get(id);

    if (!run) throw new Error('Missing evaluation');
    run.status = 'passed'; run.fingerprint = 'a'.repeat(64);
    state.storage.sql.exec('UPDATE model_evaluation SET value=? WHERE id=?', JSON.stringify(run), id);
    let stale = false;

    try { ledger.assertPassed(id, 'staging'); } catch { stale = true; }

    let missing = false;

    try { ledger.assertPassed(undefined, 'staging'); } catch { missing = true; }

    return { failed, stale, missing };
  });

  expect(result).toEqual({ failed: true, stale: true, missing: true });
});


it('rejects caller release drift before reserving evaluation allowance', async () => {
  const world = env.WORLD.getByName('evaluation-source-drift');

  const result = await runInDurableObject(world, async instance => {
    const before = instance.inspect();
    let evaluationError = '';
    let activationError = '';

    try { instance.beginEvaluation('f8d33782-ea85-4b21-a84b-c3c85ea578bc', 0.1, 'stale-release'); }
    catch (error) { evaluationError = error instanceof Error ? error.message : ''; }

    try { instance.activateLive(5, 'ENABLE_LIVE_WORLD', 'stale-release'); }
    catch (error) { activationError = error instanceof Error ? error.message : ''; }

    return { evaluationError, activationError, before, after: instance.inspect(), runs: instance.listEvaluations(), fingerprint: instance.evaluationFingerprint() };
  });

  expect(result.evaluationError).toBe('Evaluation caller and world releases differ');
  expect(result.activationError).toBe('Evaluation caller and world releases differ');
  expect(result.runs).toEqual([]);
  expect(result.after).toEqual(result.before);
  expect(result.fingerprint).toBe(releaseFingerprint);
});

it('requires scoped structured arguments in both evaluation completion and activation', async () => {
  const world = env.WORLD.getByName('evaluation-required-structured-arguments');

  const result = await runInDurableObject(world, (_instance, state) => {
    const ledger = new EvaluationLedger(state.storage.sql);
    const configuration = { enabled: true, dailyUsd: 1, environment: 'staging' };
    const base = ['tool-followup', 'private-data-policy', 'coding-build'].map(id => ({ id, passed: true, assertions: ['fixture passed'] }));
    const omittedId = crypto.randomUUID();
    ledger.begin(omittedId, 0.1, configuration, '2026-10-13T00:00:00.000Z');
    const omitted = ledger.finish(omittedId, base);
    // Even a persisted historical status cannot bypass the currently required cases.
    state.storage.sql.exec('UPDATE model_evaluation SET value=? WHERE id=?', JSON.stringify({ ...omitted, status: 'passed' }), omittedId);
    let omittedRejected = false;

    try { ledger.assertPassed(omittedId, 'staging'); } catch { omittedRejected = true; }

    const completeId = crypto.randomUUID();
    ledger.begin(completeId, 0.1, configuration, '2026-10-13T00:00:00.000Z');
    const complete = ledger.finish(completeId, [...base, { id: 'scoped-structured-arguments', passed: true, assertions: ['fixture passed'] }]);
    ledger.assertPassed(completeId, 'staging');
    const failedId = crypto.randomUUID();
    ledger.begin(failedId, 0.1, configuration, '2026-10-13T00:00:00.000Z');
    const failed = ledger.finish(failedId, [...base, { id: 'scoped-structured-arguments', passed: false, assertions: ['fixture failed'] }]);

    return { omitted: omitted.status, omittedRejected, complete: complete.status, failed: failed.status };
  });

  expect(result).toEqual({ omitted: 'failed', omittedRejected: true, complete: 'passed', failed: 'failed' });
});
