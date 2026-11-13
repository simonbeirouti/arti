import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const execute = promisify(execFile);

export function safeId(id: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) throw new Error('Invalid repository identifier');

  return id;
}

async function git(path: string, args: string[]): Promise<string> {
  const result = await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=always', '-C', path, ...args], {
    env: { PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Arti simulation', GIT_AUTHOR_EMAIL: 'simulation@arti.invalid', GIT_COMMITTER_NAME: 'Arti simulation', GIT_COMMITTER_EMAIL: 'simulation@arti.invalid' },
    maxBuffer: 2 * 1024 * 1024,
  });

  return result.stdout.trim();
}

export class LocalGitAdapter {
  constructor(readonly root: string) {}
  path(entityId: string): string { return join(this.root, 'repositories', safeId(entityId)); }
  async initialize(entityId: string, files: Record<string, string>): Promise<string> {
    const path = this.path(entityId);
    await mkdir(path, { recursive: true });

    try { return await this.head(path); } catch { /* A new repository has no HEAD. */ }

    await git(path, ['init', '-b', 'main']);

    for (const [name, text] of Object.entries(files)) await this.patch(path, name, text);

    return this.commit(path, 'Initialize entity');
  }
  async fork(entityId: string, taskId: string): Promise<{ path: string; baseCommit: string }> {
    const path = join(this.root, 'workspaces', safeId(taskId));
    await mkdir(dirname(path), { recursive: true });
    const source = this.path(entityId);
    const baseCommit = await this.head(source);
    await execute('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--no-hardlinks', '--', source, path], { env: { PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1' } });

    return { path, baseCommit };
  }
  async patch(path: string, name: string, text: string): Promise<void> {
    if (name.includes('\\') || name.startsWith('/') || name.split('/').some((part) => part === '..' || part === '.git' || part === '' || part === '.')) throw new Error('Unsafe repository path');

    if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('File exceeds simulation limit');
    const root = await realpath(path);
    const target = resolve(root, name);

    if (!target.startsWith(root + sep)) throw new Error('Path escaped repository');
    let cursor = root;

    for (const part of name.split('/')) {
      cursor = join(cursor, part);

      try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symlinks are not writable'); } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, { flag: 'w' });
  }
  async commit(path: string, message: string): Promise<string> {
    await git(path, ['add', '--all']);
    await git(path, ['commit', '--allow-empty', '-m', message]);

    return this.head(path);
  }
  head(path: string): Promise<string> { return git(path, ['rev-parse', 'HEAD']); }
  read(path: string, commit: string, file: string): Promise<string> {
    if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-zA-Z0-9/_.,-]+$/.test(file) || file.includes('..')) throw new Error('Invalid immutable file reference');

    return git(path, ['show', `${commit}:${file}`]);
  }
  diff(path: string, baseCommit: string): Promise<string> {
    if (!/^[a-f0-9]{40}$/.test(baseCommit)) throw new Error('Invalid commit');

    return git(path, ['diff', baseCommit, 'HEAD', '--']);
  }
  async promote(entityId: string, workspace: string, expectedCommit: string, commit: string): Promise<void> {
    const canonical = this.path(entityId);

    if (await this.head(canonical) !== expectedCommit) throw new Error('Canonical revision changed');

    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid commit');
    await git(canonical, ['fetch', '--', workspace, commit]);
    await git(canonical, ['update-ref', 'refs/heads/main', commit, expectedCommit]);
    await git(canonical, ['reset', '--hard', commit]);
  }
  async export(entityId: string, target: string): Promise<void> { await git(this.path(entityId), ['bundle', 'create', target, '--all']); }
}
