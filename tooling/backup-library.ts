import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, cp, readFile, writeFile, readdir, lstat, access } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';

const manifestSchema = z.object({ schemaVersion: z.literal(1), createdAt: z.string(), sourceRoot: z.string(), files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)) });

async function files(root: string, directory = root): Promise<string[]> {
  const output: string[] = [];

  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const info = await lstat(path);

    if (info.isSymbolicLink()) throw new Error('Backup cannot contain symbolic links');

    if (info.isDirectory()) output.push(...await files(root, path));
    else if (info.isFile()) output.push(relative(root, path));
  }

  return output;
}

export async function createBackup(sourceRoot: string, destination: string): Promise<void> {
  try { await access(join(sourceRoot, 'server.lock')); throw new Error('Stop the local server before backup'); } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  await mkdir(destination, { recursive: false, mode: 0o700 });

  for (const name of ['world.sqlite', 'entities.sqlite']) {
    const database = new DatabaseSync(join(sourceRoot, name), { readOnly: true });

    try { database.prepare('VACUUM INTO ?').run(join(destination, name)); } finally { database.close(); }
  }

  await cp(join(sourceRoot, 'execution'), join(destination, 'execution'), { recursive: true, errorOnExist: true, force: false });
  const hashes: Record<string, string> = {};

  for (const file of await files(destination)) hashes[file] = createHash('sha256').update(await readFile(join(destination, file))).digest('hex');

  await writeFile(join(destination, 'manifest.json'), JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), sourceRoot: resolve(sourceRoot), files: hashes }, null, 2), { mode: 0o600 });
}

export async function restoreBackup(source: string, destination: string): Promise<void> {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')));
  const actualFiles = (await files(source)).filter((file) => file !== 'manifest.json');

  if (actualFiles.length !== Object.keys(manifest.files).length) throw new Error('Backup has unexpected or missing files');

  for (const file of actualFiles) {
    const hash = createHash('sha256').update(await readFile(join(source, file))).digest('hex');

    if (manifest.files[file] !== hash) throw new Error(`Backup integrity mismatch: ${file}`);
  }

  await mkdir(destination, { recursive: false, mode: 0o700 });

  for (const file of ['world.sqlite', 'entities.sqlite', 'execution']) await cp(join(source, file), join(destination, file), { recursive: true, errorOnExist: true, force: false });

  const database = new DatabaseSync(join(destination, 'entities.sqlite'));

  try {
    database.prepare("UPDATE workspace SET body=json_set(body,'$.path',? || substr(json_extract(body,'$.path'),?)) WHERE substr(json_extract(body,'$.path'),1,?)=?").run(resolve(destination), manifest.sourceRoot.length + 1, manifest.sourceRoot.length, manifest.sourceRoot);
  } finally { database.close(); }
}
