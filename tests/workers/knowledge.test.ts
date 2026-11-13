/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { publicCloudCatalogue } from '../../apps/knowledge/generated/catalogue';
import { projectPublicKnowledge, searchPublicKnowledge } from '../../apps/world/src/knowledge';

declare global {
  namespace Cloudflare {
    interface Env { PUBLIC_INDEX?: D1Database }
  }
}

it('indexes public canonical guides and never returns private injected records', async () => {
  const database = env.PUBLIC_INDEX;

  if (!database) throw new Error('Missing D1 fixture');
  await projectPublicKnowledge(database);
  const rows = await database.prepare('SELECT id,audience FROM knowledge_documents').all<{ id: string; audience: string }>();
  expect(rows.results.every(row => row.audience === 'public')).toBe(true);
  expect(rows.results.map(row => row.id).sort()).toEqual(publicCloudCatalogue.guides.filter(guide => guide.audience === 'public').map(guide => guide.id).sort());
  await database.batch([
    database.prepare('INSERT INTO knowledge_documents VALUES(?,?,?,?,?,?,?)').bind('private-secret', 'world.authority', 'operator', 'PrivateMarker', 'PrivateMarker confidential operator evidence', 'not-public', 'definition'),
    database.prepare('INSERT INTO knowledge_search VALUES(?,?,?)').bind('private-secret', 'PrivateMarker', 'PrivateMarker confidential operator evidence'),
  ]);
  expect((await searchPublicKnowledge(database, 'PrivateMarker')).results).toHaveLength(0);
  expect((await searchPublicKnowledge(database, 'world')).results.length).toBeGreaterThan(0);
  expect((await searchPublicKnowledge(database, 'world" OR PrivateMarker*')).results).toHaveLength(0);
});

it('skips unchanged catalogue then rebuilds changed canonical guide content', async () => {
  const database = env.PUBLIC_INDEX;

  if (!database) throw new Error('Missing D1 fixture');
  await projectPublicKnowledge(database);
  await database.batch([
    database.prepare('INSERT INTO knowledge_documents VALUES(?,?,?,?,?,?,?)').bind('skip-sentinel', 'knowledge.catalogue', 'public', 'SentinelMarker', 'SentinelMarker', 'fixture', 'definition'),
    database.prepare('INSERT INTO knowledge_search VALUES(?,?,?)').bind('skip-sentinel', 'SentinelMarker', 'SentinelMarker'),
  ]);
  await projectPublicKnowledge(database);
  expect((await searchPublicKnowledge(database, 'SentinelMarker')).results).toHaveLength(1);
  const catalogue = structuredClone(publicCloudCatalogue);
  const guide = catalogue.guides[0];

  if (!guide) throw new Error('Missing public fixture guide');
  guide.title = 'ChangedCatalogueMarker';
  await projectPublicKnowledge(database, catalogue);
  expect((await searchPublicKnowledge(database, 'ChangedCatalogueMarker')).results).toHaveLength(1);
  expect((await searchPublicKnowledge(database, 'SentinelMarker')).results).toHaveLength(0);
  await projectPublicKnowledge(database);
  expect((await searchPublicKnowledge(database, 'ChangedCatalogueMarker')).results).toHaveLength(0);
});
