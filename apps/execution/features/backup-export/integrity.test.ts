import { describe, expect, it } from 'vitest';
import { bundleMainCommit, retainedApplicationExport, retainedGitExport, type ExportBucket } from './integrity';

const commit = 'a'.repeat(40);

function bucket(text: string): ExportBucket {
  return { async get() { const bytes = new TextEncoder().encode(text);

    return { size: bytes.byteLength, async arrayBuffer() { return bytes.buffer; } }; } };
}

const bundle = `# v2 git bundle\n${commit} refs/heads/main\n${commit} HEAD\n\nPACKexisting-retained-pack`;

describe('immutable backup export integrity', () => {
  it('derives the commit and checksum from retained bundle bytes, including conflict winners', async () => {
    const retained = await retainedGitExport(bucket(bundle), 'git-backups/123/builder-1.bundle');
    const fresh = await retainedGitExport(bucket(bundle.replace('existing-retained-pack', 'fresh-different-pack')), 'git-backups/123/builder-1.bundle');
    expect(retained?.commit).toBe(commit);
    expect(retained?.sha256).not.toBe(fresh?.sha256);
    expect(await retainedGitExport(bucket(bundle), 'git-backups/123/builder-1.bundle')).toEqual(retained);
  });

  it('rejects missing, duplicate, prerequisite and malformed main refs before reuse', () => {
    for (const text of [bundle.replace('refs/heads/main', 'refs/heads/other'), bundle.replace(`${commit} HEAD`, `${commit} refs/heads/main`), bundle.replace(`${commit} HEAD`, `-${commit} prerequisite`), bundle.replace('PACK', 'nope'), 'garbage']) expect(() => bundleMainCommit(new TextEncoder().encode(text))).toThrow();
  });

  it('returns null on absence and refuses oversized retained bytes', async () => {
    expect(await retainedGitExport({ async get() { return null; } }, 'missing')).toBeNull();
    await expect(retainedGitExport({ async get() { return { size: 600_001, async arrayBuffer() { throw new Error('Must not read'); } }; } }, 'large')).rejects.toThrow('size bound');
  });

  it('hashes and validates actual retained application bytes rather than regenerated data', async () => {
    const validate = (text: string): void => { if (!Array.isArray(JSON.parse(text))) throw new Error('Invalid snapshot'); };

    const retained = await retainedApplicationExport(bucket('[["app:result","before"]]'), 'app-key', validate);
    const fresh = await retainedApplicationExport(bucket('[["app:result","after"]]'), 'app-key', validate);
    expect(retained?.sha256).not.toBe(fresh?.sha256);
    await expect(retainedApplicationExport(bucket('{}'), 'app-key', validate)).rejects.toThrow('Invalid snapshot');
  });
});
