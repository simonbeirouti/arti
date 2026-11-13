import { z } from 'zod';

export const baselineDeploymentSchema = z.object({ id: z.string(), entityId: z.literal('steward'), projectId: z.literal('collective'), commit: z.string().regex(/^[a-f0-9]{40}$/), version: z.literal(1), environment: z.literal('production'), status: z.literal('published'), createdAt: z.iso.datetime(), bundleHash: z.string().regex(/^[a-f0-9]{64}$/), workerName: z.string(), authorship: z.literal('platform') }).strict();

export const resetEntityArchiveSchema = z.object({ entityId: z.string().regex(/^[a-z0-9-]{1,80}$/), key: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export type ResetEntityArchive = z.infer<typeof resetEntityArchiveSchema>;

export const resetReceiptSchema = z.object({ resetId: z.string().uuid(), archiveKey: z.string(), archiveSha256: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['reset', 'published']), workCleared: z.boolean().default(false), entityArchives: z.array(resetEntityArchiveSchema).default([]), deployment: baselineDeploymentSchema.optional(), baselineHash: z.string().optional() }).strict();

export type SharedResetReceipt = z.infer<typeof resetReceiptSchema>;

export class SharedResetLedger {
  constructor(private readonly sql: SqlStorage) {
    sql.exec('CREATE TABLE IF NOT EXISTS shared_reset_receipt(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS shared_reset_barrier(id INTEGER PRIMARY KEY CHECK(id=1),reset_id TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS shared_reset_snapshot(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
  }
  active(): string | null { return this.sql.exec<{ reset_id: string }>('SELECT reset_id FROM shared_reset_barrier WHERE id=1').toArray()[0]?.reset_id ?? null; }
  receipt(id: string): SharedResetReceipt | null {
    const value = this.sql.exec<{ value: string }>('SELECT value FROM shared_reset_receipt WHERE id=?', id).toArray()[0]?.value;

    return value ? resetReceiptSchema.parse(JSON.parse(value)) : null;
  }
  begin(id: string, source: string): string {
    const active = this.active();

    if (active && active !== id) throw new Error('Another shared reset is pending');
    this.sql.exec('INSERT INTO shared_reset_barrier(id,reset_id) VALUES(1,?) ON CONFLICT(id) DO NOTHING', id);
    this.sql.exec('INSERT INTO shared_reset_snapshot(id,value) VALUES(?,?) ON CONFLICT(id) DO NOTHING', id, source);

    return this.sql.exec<{ value: string }>('SELECT value FROM shared_reset_snapshot WHERE id=?', id).one().value;
  }
  save(receipt: SharedResetReceipt): void { this.sql.exec('INSERT INTO shared_reset_receipt(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', receipt.resetId, JSON.stringify(resetReceiptSchema.parse(receipt))); }
  complete(id: string): void { this.sql.exec('DELETE FROM shared_reset_barrier WHERE id=1 AND reset_id=?', id); this.sql.exec('DELETE FROM shared_reset_snapshot WHERE id=?', id); }
}

export function requireBaselineOperation(operation: string): void {
  const parts = operation.split(':');
  z.tuple([z.enum(['baseline.head', 'baseline.git', 'baseline.build', 'baseline.staging-smoke', 'baseline.final-head', 'baseline.production-smoke', 'deployment.upload']), z.uuid()]).parse(parts);
}
