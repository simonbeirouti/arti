import { expect, it, vi } from 'vitest';
import { releaseFingerprint } from '../../generated/release';
import { handleEvaluations, type EvaluationEnvironment, type EvaluationWorld } from './http';
import type { ModelEvaluation } from './ledger';

const id = 'f8d33782-ea85-4b21-a84b-c3c85ea578bc';

function fixture(authorityFingerprint: string, receiptFingerprint = releaseFingerprint, created = false) {
  const infer = vi.fn();
  const build = vi.fn();
  const reserve = vi.fn();
  const run: ModelEvaluation = { id, model: '@cf/zai-org/glm-4.7-flash', fingerprint: receiptFingerprint, environment: 'staging', createdAt: '2026-10-12T00:00:00.000Z', status: 'running', allowanceUsd: 0.1, reservedUsd: 0.1, cases: [] };
  const begin = vi.fn(async () => ({ run, created }));
  const world: EvaluationWorld = { evaluationFingerprint: async () => authorityFingerprint, beginEvaluation: begin, listEvaluations: async () => [], reserveEvaluation: reserve, finishEvaluation: async () => run };
  const environment: EvaluationEnvironment = { AI: { run: infer }, WORLD_BACKUPS: { put: vi.fn() }, EXECUTION: { evaluateCode: build } };
  const request = new Request('https://operator.invalid/evaluations', { method: 'POST', body: JSON.stringify({ id, allowanceUsd: 0.1, acknowledge: 'RUN_PAID_MODEL_EVALUATION' }) });

  return { world, environment, request, begin, infer, build, reserve };
}

it('rejects stale authority before creating a run or dispatching paid work', async () => {
  const test = fixture('a'.repeat(64));
  await expect(handleEvaluations(test.request, test.environment, test.world)).rejects.toThrow('Evaluation caller and world releases differ');
  expect(test.begin).not.toHaveBeenCalled();
  expect(test.infer).not.toHaveBeenCalled();
  expect(test.build).not.toHaveBeenCalled();
  expect(test.reserve).not.toHaveBeenCalled();
});

it('rejects release drift between preflight and the returned receipt before inference', async () => {
  const test = fixture(releaseFingerprint, 'a'.repeat(64), true);
  await expect(handleEvaluations(test.request, test.environment, test.world)).rejects.toThrow('Evaluation caller and world releases differ');
  expect(test.begin).toHaveBeenCalledWith(id, 0.1, releaseFingerprint);
  expect(test.infer).not.toHaveBeenCalled();
  expect(test.build).not.toHaveBeenCalled();
  expect(test.reserve).not.toHaveBeenCalled();
});
