import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { guideFingerprints, loadCatalogue, publicCatalogue, validateCatalogue } from '../../apps/knowledge/src/catalog';

describe('canonical knowledge catalogue', () => {
  it('marks verified walkthroughs stale after a dependent implementation changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arti-stale-'));

    try {
      await mkdir(join(root, 'catalog/capabilities'), { recursive: true });
      await mkdir(join(root, 'catalog/workflows'));
      await writeFile(join(root, 'guide.md'), 'Public guide');
      await writeFile(join(root, 'dependency.ts'), 'export const value = 1;');
      await writeFile(join(root, 'catalog/guides.json'), JSON.stringify([{ id: 'guide', title: 'Guide', source: 'guide.md', audience: 'public', workflows: [] }]));
      const capability = { id: 'main', title: 'Main', owner: 'test', code: [], dependencies: ['dependency'], workflows: [], guides: ['guide'], audience: ['public'] };
      await writeFile(join(root, 'catalog/capabilities/main.json'), JSON.stringify(capability));
      await writeFile(join(root, 'catalog/capabilities/dependency.json'), JSON.stringify({ ...capability, id: 'dependency', code: ['dependency.ts'], dependencies: [], guides: [] }));
      const initial = await loadCatalogue(root);
      const sources = await guideFingerprints(root, initial, 'guide');
      await writeFile(join(root, 'catalog/verification.json'), JSON.stringify([{ guideId: 'guide', environment: 'simulation', publicSafe: true, cleanup: 'complete', assertions: ['Fixture persisted'], sources, captures: [] }]));
      expect((await loadCatalogue(root)).guides[0]?.verification).toBe('verified');
      await writeFile(join(root, 'dependency.ts'), 'export const value = 2;');
      expect((await loadCatalogue(root)).guides[0]?.verification).toBe('stale');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('validates the application catalogue and keeps nonpublic guides out of publication', async () => {
    const catalogue = await loadCatalogue(process.cwd());
    await validateCatalogue(process.cwd(), catalogue);
    catalogue.guides.push({ id: 'private-memory', title: 'Private', source: 'private', audience: 'operator', workflows: [], body: 'SECRET_OPERATOR_CONTENT', verification: 'definition' });
    expect(JSON.stringify(publicCatalogue(catalogue))).not.toContain('SECRET_OPERATOR_CONTENT');
    expect(catalogue.guides.every((guide) => guide.verification === 'definition')).toBe(true);
  });

  it('rejects guide sources outside the repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arti-catalogue-'));

    try {
      await mkdir(join(root, 'catalog/capabilities'), { recursive: true });
      await mkdir(join(root, 'catalog/workflows'));
      await writeFile(join(root, 'catalog/guides.json'), JSON.stringify([{ id: 'escape', title: 'Escape', source: '../secret.md', audience: 'public', workflows: [] }]));
      await expect(loadCatalogue(root)).rejects.toThrow('escapes');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects broken references instead of publishing incomplete metadata', async () => {
    const catalogue = await loadCatalogue(process.cwd());
    catalogue.capabilities[0]?.workflows.push('missing.workflow');
    await expect(validateCatalogue(process.cwd(), catalogue)).rejects.toThrow('Missing workflow');
  });
});
