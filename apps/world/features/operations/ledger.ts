import { z } from 'zod';

const trafficSchema = z.object({ entityId: z.string().min(1).max(100), kind: z.enum(['unclassified', 'internal', 'synthetic']), status: z.number().int().min(100).max(599), elapsedMs: z.number().finite().min(0).max(3600000), requestId: z.string().min(1).max(200) });

export type TrafficKind = z.infer<typeof trafficSchema>['kind'];

export class OperationsLedger {
  constructor(private sql: SqlStorage) {
    sql.exec('CREATE TABLE IF NOT EXISTS operations_metric(name TEXT PRIMARY KEY, value INTEGER NOT NULL, updated INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS traffic_receipt(id TEXT PRIMARY KEY, created INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS traffic_daily(day TEXT NOT NULL, entity TEXT NOT NULL, kind TEXT NOT NULL, requests INTEGER NOT NULL, errors INTEGER NOT NULL, elapsed REAL NOT NULL, PRIMARY KEY(day,entity,kind))');
  }
  note(name: string, value: number, now = Date.now()): void {
    if (!/^[a-z_.]{1,80}$/.test(name) || !Number.isFinite(value)) throw new Error('Invalid metric');
    this.sql.exec('INSERT INTO operations_metric(name,value,updated) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated=excluded.updated', name, value, now);
  }
  increment(name: string): void {
    const current = this.sql.exec<{ value: number }>('SELECT value FROM operations_metric WHERE name=?', name).toArray()[0]?.value ?? 0;
    this.note(name, current + 1);
  }
  inspect(): { name: string; value: number; updated: number }[] {
    return this.sql.exec<{ name: string; value: number; updated: number }>('SELECT name,value,updated FROM operations_metric ORDER BY name').toArray();
  }
  traffic(input: z.input<typeof trafficSchema>, now = Date.now()): void {
    const record = trafficSchema.parse(input);

    if (this.sql.exec('SELECT id FROM traffic_receipt WHERE id=?', record.requestId).toArray().length) return;
    this.sql.exec('INSERT INTO traffic_receipt(id,created) VALUES(?,?)', record.requestId, now);
    this.sql.exec('DELETE FROM traffic_receipt WHERE created<?', now - 86400000);
    this.sql.exec('INSERT INTO traffic_daily(day,entity,kind,requests,errors,elapsed) VALUES(?,?,?,1,?,?) ON CONFLICT(day,entity,kind) DO UPDATE SET requests=requests+1,errors=errors+excluded.errors,elapsed=elapsed+excluded.elapsed', new Date(now).toISOString().slice(0, 10), record.entityId, record.kind, record.status >= 500 ? 1 : 0, record.elapsedMs);
  }
  analytics(): { day: string; entity: string; kind: string; requests: number; errors: number; elapsed: number }[] {
    return this.sql.exec<{ day: string; entity: string; kind: string; requests: number; errors: number; elapsed: number }>('SELECT day,entity,kind,requests,errors,elapsed FROM traffic_daily ORDER BY day DESC,entity,kind LIMIT 2000').toArray();
  }
}
