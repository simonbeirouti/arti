import { z } from 'zod';

/** Additional subset cap; global/entity world reservations remain authoritative. */
export class MaintenanceLedger {
  constructor(private sql: SqlStorage) { sql.exec('CREATE TABLE IF NOT EXISTS maintenance_reservation(id TEXT PRIMARY KEY,entity TEXT NOT NULL,estimate REAL NOT NULL,created INTEGER NOT NULL)'); }
  reserve(id: string, entityId: string, estimate: number, allowanceUsd: number, committedUsd: number): void {
    z.number().finite().positive().max(1000).parse(allowanceUsd);
    z.number().finite().positive().max(1).parse(estimate);

    if (this.sql.exec('SELECT id FROM maintenance_reservation WHERE id=?', id).toArray().length) throw new Error('Maintenance dispatch already reserved');
    z.number().finite().nonnegative().parse(committedUsd);

    if (committedUsd + estimate > allowanceUsd) throw new Error('Maintenance subset allowance exhausted; reconcile unknown costs');
    this.sql.exec('INSERT INTO maintenance_reservation(id,entity,estimate,created) VALUES(?,?,?,?)', id, entityId, estimate, Date.now());
  }
}
