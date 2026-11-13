import { createHash } from 'node:crypto';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { loadCatalogue, publicCatalogue, validateCatalogue } from '../apps/knowledge/src/catalog';

const root = process.cwd();

const catalogue = await loadCatalogue(root);

await validateCatalogue(root, catalogue);

await mkdir(resolve(root, 'apps/knowledge/generated'), { recursive: true });

await writeFile(resolve(root, 'apps/knowledge/generated/catalogue.ts'), `// Generated from canonical sources by tooling/cloud-catalogue.ts. Do not edit.\nexport const cloudCatalogue = ${JSON.stringify(catalogue)};\n\nexport const publicCloudCatalogue = ${JSON.stringify(publicCatalogue(catalogue))};\n`);

console.log('Worker catalogue generated from canonical audience-scoped sources.');

// Pin evaluation approval to executable platform sources, including authorization
// and the evaluation fixtures. Generated outputs cannot recursively hash themselves.
const hash = createHash('sha256');

async function fingerprint(directory: string): Promise<void> {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (['generated', 'dist', 'node_modules', '.wrangler'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) await fingerprint(path);
    else if (entry.isFile() && (/\.(ts|tsx|mjs|jsonc)$/u.test(entry.name) || entry.name === 'Dockerfile' || entry.name === 'package.json')) {
      hash.update(relative(root, path));
      hash.update('\0');
      hash.update(await readFile(path));
    }
  }
}

for (const directory of ['apps/world', 'apps/agent-runtime', 'apps/execution', 'packages/contracts', 'packages/domain', 'packages/provider-adapters']) await fingerprint(resolve(root, directory));

hash.update(await readFile(resolve(root, 'pnpm-lock.yaml')));

await mkdir(resolve(root, 'apps/world/generated'), { recursive: true });

await writeFile(resolve(root, 'apps/world/generated/release.ts'), `// Generated release approval fingerprint.\nexport const releaseFingerprint = '${hash.digest('hex')}';\n`);
