import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { WorldState } from '../packages/contracts/src/index';
import { parseWorldState } from '../packages/domain/src/index';

const snapshotRow = z.object({ body: z.string() });

/** Local simulation persistence; production uses the World Durable Object. */
export class LocalWorldStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (sequence INTEGER PRIMARY KEY, body TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
    `);
  }

  load(): WorldState | undefined {
    const row = this.database.prepare('SELECT body FROM snapshot WHERE id=1').get();

    if (!row) return undefined;

    return parseWorldState(snapshotRow.parse(row).body);
  }

  save(state: WorldState): void {
    this.database.exec('BEGIN IMMEDIATE');

    try {
      this.database.prepare('INSERT INTO snapshot VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(state));
      const insert = this.database.prepare('INSERT OR IGNORE INTO outbox(sequence,body) VALUES(?,?)');

      for (const event of state.events) insert.run(event.sequence, JSON.stringify(event));

      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }
}
