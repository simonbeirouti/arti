-- Rebuildable projections only. Canonical state lives in the World Durable Object.
CREATE TABLE IF NOT EXISTS public_world (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sequence INTEGER NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value))
);
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('public','developer','agent','operator')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  verification TEXT NOT NULL CHECK (verification IN ('definition','verified','stale'))
);
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_search USING fts5(id UNINDEXED, title, body);
