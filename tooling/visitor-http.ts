import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { handleVisitorRequest, visitorPaths } from '../apps/world/features/visitor-http/http';
import { z } from 'zod';
import type { ApiService } from './api-service';

/** Same public HTTP boundary locally; sessions survive server restarts. */
export function localVisitorHttp(dataRoot: string, service: ApiService) {
  const database = new DatabaseSync(join(dataRoot, 'visitors.sqlite'));
  database.exec('CREATE TABLE IF NOT EXISTS visitor_session(hash TEXT PRIMARY KEY,visitorId TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS visitor_intake(ip TEXT NOT NULL,created INTEGER NOT NULL)');
  const sessionSchema = z.object({ hash: z.string(), visitorId: z.string(), expires: z.number() });

  const ledger = {
    get(hash: string) {
      const row = database.prepare('SELECT hash,visitorId,expires FROM visitor_session WHERE hash=? AND expires>?').get(hash, Date.now());

      return row ? sessionSchema.parse(row) : undefined;
    },
    put(session: z.infer<typeof sessionSchema>) {
      database.prepare('DELETE FROM visitor_session WHERE expires<=?').run(Date.now());
      database.prepare('INSERT INTO visitor_session(hash,visitorId,expires) VALUES(?,?,?) ON CONFLICT(hash) DO UPDATE SET expires=excluded.expires').run(session.hash, session.visitorId, session.expires);
    },
    intake(ipHash: string, now: number) {
      database.prepare('DELETE FROM visitor_intake WHERE created<=?').run(now - 86400000);
      const countSchema = z.object({ total: z.number() });
      const perIp = countSchema.parse(database.prepare('SELECT COUNT(*) AS total FROM visitor_intake WHERE ip=? AND created>?').get(ipHash, now - 600000)).total;
      const total = countSchema.parse(database.prepare('SELECT COUNT(*) AS total FROM visitor_intake WHERE created>?').get(now - 600000)).total;

      if (perIp >= 10 || total >= 100) throw new Error('Session creation limit reached');
      database.prepare('INSERT INTO visitor_intake(ip,created) VALUES(?,?)').run(ipHash, now);
    },
  };

  return {
    close: () => database.close(),
    async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

      if (url.pathname === '/api/v1/public/build' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(service.getPublicBuild()));

        return true;
      }

      if (!visitorPaths.has(url.pathname)) return false;
      const headers = new Headers();

      for (const [name, value] of Object.entries(request.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const parts: Buffer[] = [];
      let size = 0;

      for await (const part of request) {
        size += Buffer.byteLength(part);

        if (size > 8192) { response.writeHead(413); response.end('Request too large');

 return true; }

        parts.push(Buffer.from(part));
      }

      // Vite's same-origin proxy preserves the visitor's host and origin.
      const origin = headers.get('Origin');
      const external = origin && /^http:\/\/(?:localhost|127\.0\.0\.1):5173$/.test(origin) ? new URL(url.pathname, origin) : url;

      const result = await handleVisitorRequest(new Request(external, { method: request.method, headers, body: request.method === 'POST' ? Buffer.concat(parts) : undefined }), {
        session: async hash => { const session = ledger.get(hash);

 return session ? service.visitor(session.visitorId) : null; },
        onboard: (hash, name, ipHash) => service.visitorMutation(engine => {
          ledger.intake(ipHash, Date.now());
          const visitor = engine.upsertVisitor(ledger.get(hash)?.visitorId ?? `visitor-${crypto.randomUUID()}`, name);
          ledger.put({ hash, visitorId: visitor.id, expires: Date.now() + 30 * 86400000 });

          return visitor;
        }),
        suggest: (hash, text, key, ipHash) => service.visitorMutation(engine => {
          const session = ledger.get(hash);

          if (!session) throw new Error('Visitor session required');

          return engine.submitSuggestion(session.visitorId, text, key, ipHash);
        }),
      }, request.socket.remoteAddress ?? 'local');

      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());

      return true;
    },
  };
}
