import { z } from 'zod';
import { releaseFingerprint } from '../../generated/release';

export const evaluatedModel = '@cf/zai-org/glm-4.7-flash';

export function assertEvaluationRelease(expectedFingerprint: string): void {
  if (expectedFingerprint !== releaseFingerprint) throw new Error('Evaluation caller and world releases differ');
}

export const evaluationCaseSchema = z.object({ id: z.string(), passed: z.boolean(), assertions: z.array(z.string()), responseHash: z.string().optional(), captureKey: z.string().optional() });

export const evaluationSchema = z.object({ id: z.string().uuid(), model: z.literal(evaluatedModel), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), environment: z.string().min(1), createdAt: z.string(), status: z.enum(['running', 'passed', 'failed']), allowanceUsd: z.number().positive(), reservedUsd: z.number().nonnegative(), cases: z.array(evaluationCaseSchema) });

export type EvaluationStart = { run: ModelEvaluation; created: boolean };

export type ModelEvaluation = z.infer<typeof evaluationSchema>;

const rowSchema = z.object({ value: z.string() });

const requiredCases = ['tool-followup', 'private-data-policy', 'coding-build', 'scoped-structured-arguments'];

function casesPassed(cases: ModelEvaluation['cases']): boolean { return requiredCases.every(name => cases.some(item => item.id === name && item.passed)) && cases.every(item => item.passed); }

export class EvaluationLedger {
  constructor(private readonly sql: SqlStorage) {
    sql.exec('CREATE TABLE IF NOT EXISTS model_evaluation(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS evaluation_charge(run_id TEXT NOT NULL,operation TEXT NOT NULL,estimate REAL NOT NULL,authorized INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(run_id,operation))');
  }
  get(id: string): ModelEvaluation | null {
    const row = this.sql.exec('SELECT value FROM model_evaluation WHERE id=?', id).toArray()[0];

    return row ? evaluationSchema.parse(JSON.parse(rowSchema.parse(row).value)) : null;
  }
  list(): ModelEvaluation[] {
    return this.sql.exec('SELECT value FROM model_evaluation ORDER BY rowid DESC LIMIT 50').toArray().map(row => evaluationSchema.parse(JSON.parse(rowSchema.parse(row).value)));
  }
  listAll(): ModelEvaluation[] {
    return this.sql.exec('SELECT value FROM model_evaluation ORDER BY rowid').toArray().map(row => evaluationSchema.parse(JSON.parse(rowSchema.parse(row).value)));
  }
  begin(id: string, maxUsd: number, configuration: { enabled: boolean; dailyUsd: number; environment: string }, now: string): EvaluationStart {
    z.string().uuid().parse(id);
    z.number().min(0.1).max(1).parse(maxUsd);

    if (!configuration.enabled) throw new Error('Paid evaluation requires configured allowance and release fingerprint: evaluations disabled');

    if (!Number.isFinite(configuration.dailyUsd) || configuration.dailyUsd <= 0) throw new Error('Paid evaluation requires configured allowance and release fingerprint: allowance must be finite and positive');

    if (!configuration.environment) throw new Error('Paid evaluation requires configured allowance and release fingerprint: environment missing');

    if (!/^[a-f0-9]{64}$/u.test(releaseFingerprint)) throw new Error('Paid evaluation requires configured allowance and release fingerprint: release fingerprint invalid');
    const existing = this.get(id);

    if (existing) {
      if (existing.allowanceUsd !== maxUsd || existing.fingerprint !== releaseFingerprint || existing.environment !== configuration.environment) throw new Error('Evaluation idempotency conflict');

      return { run: existing, created: false };
    }

    const row = this.sql.exec<{ committed: number }>("SELECT COALESCE(SUM(json_extract(value,'$.reservedUsd')),0) AS committed FROM model_evaluation WHERE substr(json_extract(value,'$.createdAt'),1,10)=?", now.slice(0, 10)).one();

    if (row.committed + maxUsd > configuration.dailyUsd) throw new Error('Evaluation daily allowance exhausted');
    const run: ModelEvaluation = { id, model: evaluatedModel, fingerprint: releaseFingerprint, environment: configuration.environment, createdAt: now, status: 'running', allowanceUsd: maxUsd, reservedUsd: maxUsd, cases: [] };
    this.sql.exec('INSERT INTO model_evaluation VALUES(?,?)', id, JSON.stringify(run));

    return { run, created: true };
  }
  reserve(id: string, operation: string, estimate: number, now = new Date().toISOString()): void {
    const run = this.get(id);

    if (!run || run.status !== 'running' || run.fingerprint !== releaseFingerprint || run.createdAt.slice(0, 10) !== now.slice(0, 10)) throw new Error('Evaluation is not current and running');
    z.number().positive().max(0.1).parse(estimate);

    if (this.sql.exec('SELECT operation FROM evaluation_charge WHERE run_id=? AND operation=?', id, operation).toArray().length) throw new Error('Evaluation operation already dispatched');
    const spent = this.sql.exec<{ amount: number }>('SELECT COALESCE(SUM(estimate),0) AS amount FROM evaluation_charge WHERE run_id=?', id).one().amount;

    if (spent + estimate > run.allowanceUsd) throw new Error('Evaluation run allowance exhausted');
    this.sql.exec('INSERT INTO evaluation_charge(run_id,operation,estimate) VALUES(?,?,?)', id, operation, estimate);
  }
  authorize(id: string, operation: string, now = new Date().toISOString()): void {
    const run = this.get(id);
    const charge = this.sql.exec<{ authorized: number }>('SELECT authorized FROM evaluation_charge WHERE run_id=? AND operation=?', id, operation).toArray()[0];

    if (!run || run.status !== 'running' || run.fingerprint !== releaseFingerprint || run.createdAt.slice(0, 10) !== now.slice(0, 10) || operation !== 'coding-build' || !charge || charge.authorized !== 0) throw new Error('Evaluation build is not authorized');
    this.sql.exec('UPDATE evaluation_charge SET authorized=1 WHERE run_id=? AND operation=?', id, operation);
  }
  finish(id: string, cases: ModelEvaluation['cases']): ModelEvaluation {
    const run = this.get(id);

    if (!run || run.status !== 'running') throw new Error('Evaluation is not running');
    run.cases = z.array(evaluationCaseSchema).parse(cases);
    run.status = casesPassed(run.cases) ? 'passed' : 'failed';
    run.reservedUsd = this.sql.exec<{ amount: number }>('SELECT COALESCE(SUM(estimate),0) AS amount FROM evaluation_charge WHERE run_id=?', id).one().amount;
    this.sql.exec('UPDATE model_evaluation SET value=? WHERE id=?', JSON.stringify(run), id);

    return run;
  }
  assertPassed(id: string | undefined, environment: string | undefined): void {
    const run = id ? this.get(id) : null;

    if (!run || run.status !== 'passed' || run.fingerprint !== releaseFingerprint || run.model !== evaluatedModel || run.environment !== environment || !casesPassed(run.cases)) throw new Error('A passed current-release model evaluation is required');
  }
}
