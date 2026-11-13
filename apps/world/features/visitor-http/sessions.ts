import type { VisitorSession } from './http';

export interface SessionStore {
  get(hash: string): VisitorSession | undefined;
  put(session: VisitorSession): void;
  intake(ipHash: string, now: number): void;
}

/** WORLD-owned session tokens are stored only as hashes; names never confer authority. */
export class VisitorSessionLedger implements SessionStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec('CREATE TABLE IF NOT EXISTS visitor_session(hash TEXT PRIMARY KEY, visitorId TEXT NOT NULL, expires INTEGER NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS visitor_intake(ip TEXT NOT NULL, created INTEGER NOT NULL)');
  }
  get(hash: string): VisitorSession | undefined {
    return this.sql.exec<{ hash: string; visitorId: string; expires: number }>('SELECT hash,visitorId,expires FROM visitor_session WHERE hash=? AND expires>?', hash, Date.now()).toArray()[0];
  }
  put(session: VisitorSession): void {
    this.sql.exec('DELETE FROM visitor_session WHERE expires<=?', Date.now());
    this.sql.exec('INSERT INTO visitor_session(hash,visitorId,expires) VALUES(?,?,?) ON CONFLICT(hash) DO UPDATE SET expires=excluded.expires', session.hash, session.visitorId, session.expires);
  }
  intake(ipHash: string, now: number): void {
    this.sql.exec('DELETE FROM visitor_intake WHERE created<=?', now - 86400000);
    const count = this.sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM visitor_intake WHERE ip=? AND created>?', ipHash, now - 600000).one().total;

    const total = this.sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM visitor_intake WHERE created>?', now - 600000).one().total;

    if (total >= 100) throw new Error('Session creation limit reached');

    if (count >= 10) throw new Error('Session creation limit reached');
    this.sql.exec('INSERT INTO visitor_intake(ip,created) VALUES(?,?)', ipHash, now);
  }
}
