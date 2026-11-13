import { releaseFingerprint } from '../../generated/release';
import { z } from 'zod';
import { evaluatedModel, assertEvaluationRelease, type ModelEvaluation } from './ledger';
import { runModelEvaluation, responseSchema } from './engine';

export interface EvaluationWorld {
  evaluationFingerprint(): Promise<string>;
  listEvaluations(): Promise<ModelEvaluation[]>;
  beginEvaluation(id: string, allowanceUsd: number, expectedFingerprint: string): Promise<{ run: ModelEvaluation; created: boolean }>;
  reserveEvaluation(id: string, operation: string, estimate: number): Promise<void>;
  finishEvaluation(id: string, cases: ModelEvaluation['cases']): Promise<ModelEvaluation>;
}

export type EvaluationEnvironment = {
  AI?: Pick<Ai, 'run'>;
  WORLD_BACKUPS?: Pick<R2Bucket, 'put'>;
  EXECUTION?: { evaluateCode(id: string, worker: string, tests: string): Promise<{ compiled: string; assertions: string[] }> };
};

// Called only after the operator Access identity and same-origin checks have passed.
export async function handleEvaluations(request: Request, environment: EvaluationEnvironment, world: EvaluationWorld): Promise<Response> {
  if (request.method === 'GET') return Response.json({ evaluations: await world.listEvaluations() }, { headers: { 'Cache-Control': 'no-store' } });

  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const input = z.object({ id: z.string().uuid(), allowanceUsd: z.number().min(0.1).max(1), acknowledge: z.literal('RUN_PAID_MODEL_EVALUATION') }).strict().parse(await request.json());
  const { AI, WORLD_BACKUPS, EXECUTION } = environment;

  if (!AI || !WORLD_BACKUPS || !EXECUTION) throw new Error('Evaluation provider bindings are incomplete');
  assertEvaluationRelease(await world.evaluationFingerprint());
  const started = await world.beginEvaluation(input.id, input.allowanceUsd, releaseFingerprint);

  assertEvaluationRelease(started.run.fingerprint);

  if (!started.created) return Response.json(started.run, { headers: { 'Cache-Control': 'no-store' } });

  const cases = await runModelEvaluation({
    reserve: (operation, estimate) => world.reserveEvaluation(input.id, operation, estimate),
    infer: async payload => {
      const model: keyof AiModels = evaluatedModel;

      return responseSchema.parse(await AI.run(model, payload));
    },
    build: (worker, tests) => EXECUTION.evaluateCode(input.id, worker, tests),
    save: async (caseId, value) => {
      const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
      const key = `evaluations/${input.id}/${caseId}/${hash}.json`;
      await WORLD_BACKUPS.put(key, value, { onlyIf: { etagDoesNotMatch: '*' }, customMetadata: { evaluationId: input.id, sha256: hash, visibility: 'private' } });

      return { hash, key };
    },
  });

  return Response.json(await world.finishEvaluation(input.id, cases), { headers: { 'Cache-Control': 'no-store' } });
}
