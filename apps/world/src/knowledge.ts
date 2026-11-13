/// <reference types="@cloudflare/workers-types" />
import { publicCloudCatalogue } from '../../knowledge/generated/catalogue';

export function knowledgeQuery(input: string): string | null {
  const tokens = input.slice(0, 200).match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 8) ?? [];

  return tokens.length ? tokens.map(token => `"${token}"`).join(' AND ') : null;
}

async function fingerprint(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));

  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function projectPublicKnowledge(database: D1Database, catalogue = publicCloudCatalogue): Promise<void> {
  await database.batch([
    database.prepare('CREATE TABLE IF NOT EXISTS knowledge_documents (id TEXT PRIMARY KEY, capability_id TEXT NOT NULL, audience TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, source_commit TEXT NOT NULL, verification TEXT NOT NULL)'),
    database.prepare('CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_search USING fts5(id UNINDEXED,title,body)'),
    database.prepare('CREATE TABLE IF NOT EXISTS knowledge_projection (id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL)'),
  ]);
  const hash = await fingerprint(JSON.stringify(catalogue));
  const current = await database.prepare('SELECT fingerprint FROM knowledge_projection WHERE id=1').first<string>('fingerprint');

  if (current === hash) return;
  const statements = [database.prepare('DELETE FROM knowledge_search'), database.prepare('DELETE FROM knowledge_documents')];

  for (const guide of catalogue.guides) {
    if (guide.audience !== 'public') continue;
    const capability = catalogue.capabilities.find(item => item.guides.includes(guide.id));
    const source = `content-sha256:${await fingerprint(guide.body)}`;
    statements.push(database.prepare('INSERT INTO knowledge_documents(id,capability_id,audience,title,body,source_commit,verification) VALUES(?,?,?,?,?,?,?)').bind(guide.id, capability?.id ?? 'knowledge.catalogue', 'public', guide.title, guide.body, source, guide.verification));
    statements.push(database.prepare('INSERT INTO knowledge_search(id,title,body) VALUES(?,?,?)').bind(guide.id, guide.title, guide.body));
  }

  statements.push(database.prepare('INSERT INTO knowledge_projection(id,fingerprint) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint').bind(hash));
  await database.batch(statements);
}

export async function searchPublicKnowledge(database: D1Database, input: string): Promise<D1Result<{ id: string; title: string; body: string; verification: string; sourceFingerprint: string }>> {
  const query = knowledgeQuery(input);

  if (!query) return { results: [], success: true, meta: { duration: 0, changes: 0, last_row_id: 0, changed_db: false, size_after: 0, rows_read: 0, rows_written: 0 } };

  return database.prepare("SELECT d.id,d.title,d.body,d.verification,d.source_commit AS sourceFingerprint FROM knowledge_search JOIN knowledge_documents d ON d.id=knowledge_search.id WHERE knowledge_search MATCH ? AND d.audience='public' ORDER BY bm25(knowledge_search) LIMIT 20").bind(query).all();
}
