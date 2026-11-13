/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { helloWorldWorker, helloWorldTests, helloWorldServices } from '../visitor-baseline/content';
import { buildFailure, type BuildFailure } from './build-diagnostics';

export const buildInputSchema = z.object({ worker: z.string().max(200_000), tests: z.string().max(100_000) }).strict();

export const buildOutputSchema = z.object({ compiled: z.string().max(1_000_000), assertions: z.array(z.string()).min(3) }).strict();

export type BuildInput = z.infer<typeof buildInputSchema>;

export type BuildOutput = z.infer<typeof buildOutputSchema>;

/** Each job gets a unique container with no Internet or bound provider secrets. */
export class BuildSandbox extends DurableObject {
  private async git(container: Container, args: string[], token: string, platformAuthor = false): Promise<string> {
    const process = await container.exec(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', ...args], {
      signal: AbortSignal.timeout(60_000),
      env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', HOME: '/nonexistent', GIT_AUTHOR_NAME: platformAuthor ? 'Arti platform' : 'Arti entity', GIT_AUTHOR_EMAIL: platformAuthor ? 'platform@arti.invalid' : 'entity@arti.invalid', GIT_COMMITTER_NAME: platformAuthor ? 'Arti platform' : 'Arti entity', GIT_COMMITTER_EMAIL: platformAuthor ? 'platform@arti.invalid' : 'entity@arti.invalid' },
    });

    const output = await process.output();

    if (output.exitCode !== 0) throw new Error('Trusted Git transport failed');

    return new TextDecoder().decode(output.stdout).trim();
  }
  private remote(value: string): string {
    const url = new URL(value);

    if (url.protocol !== 'https:' || !url.hostname.endsWith('.artifacts.cloudflare.net') || url.username || url.password || url.port || !url.pathname.startsWith('/git/')) throw new Error('Untrusted Git remote');

    return url.href;
  }
  /** Fixed owner-approved platform starter; never accepts caller-provided source or Git author. */
  async bootstrapBaseline(remote: string, token: string, expectedHead: string, resetId: string): Promise<string> {
    z.uuid().parse(resetId);
    z.string().regex(/^[a-f0-9]{40}$/).parse(expectedHead);
    const container = this.ctx.container;

    if (!container || !container.images.build || container.running) throw new Error('Fresh transport container required');
    container.start({ image: container.images.build, entrypoint: ['sleep', 'infinity'], enableInternet: true });

    try {
      await this.git(container, ['clone', '--no-checkout', this.remote(remote), '/workspace'], token);
      await this.git(container, ['-C', '/workspace', 'checkout', 'main'], '');
      const head = await this.git(container, ['-C', '/workspace', 'rev-parse', 'HEAD'], '');

      if (head !== expectedHead) throw new Error('Canonical baseline revision changed');
      const script = "import fs from 'node:fs/promises';import path from 'node:path';let text='';for await(const chunk of process.stdin)text+=chunk;const files=JSON.parse(text);for(const file of files){let current='/workspace';for(const part of file.path.split('/')){current=path.join(current,part);try{if((await fs.lstat(current)).isSymbolicLink())throw Error('Symlink refused')}catch(error){if(error.code!=='ENOENT')throw error}}await fs.mkdir(path.dirname(current),{recursive:true});await fs.writeFile(current,file.content)}";
      const process = await container.exec(['node', '--input-type=module', '-e', script], { stdin: 'pipe', signal: AbortSignal.timeout(15000), env: {} });

      if (!process.stdin) throw new Error('Missing baseline source input');
      const writer = process.stdin.getWriter();
      await writer.write(new TextEncoder().encode(JSON.stringify([{ path: 'site/worker.ts', content: helloWorldWorker }, { path: 'tests/worker.test.mjs', content: helloWorldTests }, { path: 'site/services.json', content: helloWorldServices }])));
      await writer.close();
      const output = await process.output();

      if (output.exitCode !== 0) throw new Error('Platform baseline source write failed');
      await this.git(container, ['-C', '/workspace', 'add', '--', 'site/worker.ts', 'tests/worker.test.mjs', 'site/services.json'], '');
      await this.git(container, ['-C', '/workspace', 'commit', '--allow-empty', '-m', `Platform Hello World baseline ${resetId}`], '', true);
      const commit = await this.git(container, ['-C', '/workspace', 'rev-parse', 'HEAD'], '');
      await this.git(container, ['-C', '/workspace', 'push', this.remote(remote), 'HEAD:refs/heads/main'], token);
      z.string().regex(/^[a-f0-9]{40}$/).parse(commit);

      return commit;
    } finally { await container.destroy(); }
  }
  async edit(remote: string, token: string, path: string, content: string, message: string): Promise<string> {
    if (!/^(site|tests|content)\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes('..') || path.includes('/.git') || content.length > 200_000 || message.length > 500) throw new Error('Invalid entity patch');
    const container = this.ctx.container;

    if (!container || !container.images.build || container.running) throw new Error('Fresh transport container required');
    container.start({ image: container.images.build, entrypoint: ['sleep', 'infinity'], enableInternet: true });

    try {
      await this.git(container, ['clone', '--no-checkout', this.remote(remote), '/workspace'], token);
      await this.git(container, ['-C', '/workspace', 'checkout', 'main'], '');
      const script = `const fs=require('node:fs/promises');const path=require('node:path');let text='';for await(const chunk of process.stdin)text+=chunk;const input=JSON.parse(text);let current='/workspace';for(const part of input.path.split('/')){current=path.join(current,part);try{if((await fs.lstat(current)).isSymbolicLink())throw Error('Symlink refused')}catch(error){if(error.code!=='ENOENT')throw error}}await fs.mkdir(path.dirname(current),{recursive:true});await fs.writeFile(current,input.content);`;
      const process = await container.exec(['node', '--input-type=module', '-e', script.replace("const fs=require('node:fs/promises');const path=require('node:path');", "import fs from 'node:fs/promises';import path from 'node:path';")], { stdin: 'pipe', signal: AbortSignal.timeout(15_000), env: {} });

      if (!process.stdin) throw new Error('Missing patch input');
      const writer = process.stdin.getWriter();
      await writer.write(new TextEncoder().encode(JSON.stringify({ path, content })));
      await writer.close();
      const output = await process.output();

      if (output.exitCode !== 0) throw new Error('Patch failed');
      await this.git(container, ['-C', '/workspace', 'add', '--', path], '');
      await this.git(container, ['-C', '/workspace', 'commit', '--allow-empty', '-m', message], '');
      const commit = await this.git(container, ['-C', '/workspace', 'rev-parse', 'HEAD'], '');
      await this.git(container, ['-C', '/workspace', 'push', this.remote(remote), 'HEAD:refs/heads/main'], token);

      if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid commit receipt');

      return commit;
    } finally { await container.destroy(); }
  }
  async restoreGit(remote: string, writeToken: string, base64: string, commit: string): Promise<void> {
    if (!/^[a-f0-9]{40}$/.test(commit) || !/^[A-Za-z0-9+/=]+$/.test(base64) || base64.length > 800_000) throw new Error('Invalid Git backup');
    const container = this.ctx.container;

    if (!container || !container.images.build || container.running) throw new Error('Fresh transport container required');
    container.start({ image: container.images.build, entrypoint: ['sleep', 'infinity'], enableInternet: true });

    try {
      const head = await this.git(container, ['ls-remote', this.remote(remote), 'refs/heads/main'], writeToken);
      const expected = head.split(/\s+/)[0];

      if (!/^[a-f0-9]{40}$/.test(expected)) throw new Error('Cannot fence canonical restore');
      const process = await container.exec(['node', '-e', "const fs=require('node:fs');let text='';process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>fs.writeFileSync('/restore.bundle',Buffer.from(text,'base64')));"], { stdin: 'pipe', signal: AbortSignal.timeout(15_000), env: {} });

      if (!process.stdin) throw new Error('Missing restore input');
      const writer = process.stdin.getWriter();
      await writer.write(new TextEncoder().encode(base64));
      await writer.close();
      const output = await process.output();

      if (output.exitCode !== 0) throw new Error('Restore input failed');
      await this.git(container, ['init', '--bare', '/restore'], '');
      await this.git(container, ['-C', '/restore', 'bundle', 'verify', '/restore.bundle'], '');
      await this.git(container, ['-C', '/restore', '-c', 'protocol.file.allow=always', 'fetch', '/restore.bundle', 'refs/heads/main:refs/heads/main'], '');
      const restored = await this.git(container, ['-C', '/restore', 'rev-parse', 'refs/heads/main'], '');

      if (restored !== commit) throw new Error('Restored canonical revision mismatch');
      await this.git(container, ['-C', '/restore', 'push', `--force-with-lease=refs/heads/main:${expected}`, this.remote(remote), 'refs/heads/main:refs/heads/main'], writeToken);
    } finally { await container.destroy(); }
  }
  async exportGit(remote: string, readToken: string): Promise<{ commit: string; base64: string }> {
    const container = this.ctx.container;

    if (!container || !container.images.build || container.running) throw new Error('Fresh transport container required');
    container.start({ image: container.images.build, entrypoint: ['sleep', 'infinity'], enableInternet: true });

    try {
      await this.git(container, ['clone', '--mirror', this.remote(remote), '/backup'], readToken);
      const commit = await this.git(container, ['-C', '/backup', 'rev-parse', 'refs/heads/main'], '');
      await this.git(container, ['-C', '/backup', 'bundle', 'create', '/backup.bundle', '--all'], '');
      const process = await container.exec(['node', '-e', "const fs=require('node:fs');const bytes=fs.readFileSync('/backup.bundle');if(bytes.length>600000)throw Error('Backup exceeds bounded RPC export');process.stdout.write(bytes.toString('base64'));"], { signal: AbortSignal.timeout(15_000), env: {} });
      const output = await process.output();

      if (output.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Git export failed');

      return { commit, base64: new TextDecoder().decode(output.stdout) };
    } finally { await container.destroy(); }
  }
  async canonicalHead(remote: string, readToken: string): Promise<string> {
    const container = this.ctx.container;

    if (!container || !container.images.build || container.running) throw new Error('Fresh transport container required');
    container.start({ image: container.images.build, entrypoint: ['sleep', 'infinity'], enableInternet: true });

    try {
      const output = await this.git(container, ['ls-remote', this.remote(remote), 'refs/heads/main'], readToken);
      const head = output.split(/\s+/)[0];

      if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('Canonical main is not initialized');

      return head;
    } finally { await container.destroy(); }
  }
  async promote(forkRemote: string, canonicalRemote: string, readToken: string, writeToken: string, expected: string, commit: string): Promise<void> {
    if (!/^[a-f0-9]{40}$/.test(expected) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid promotion revision');
    const container = this.ctx.container;

    if (!container || !container.images.build || container.running) throw new Error('Fresh transport container required');
    container.start({ image: container.images.build, entrypoint: ['sleep', 'infinity'], enableInternet: true });

    try {
      await this.git(container, ['init', '--bare', '/promotion'], '');
      await this.git(container, ['-C', '/promotion', 'fetch', this.remote(forkRemote), commit], readToken);
      await this.git(container, ['-C', '/promotion', 'fetch', this.remote(canonicalRemote), expected], writeToken);
      await this.git(container, ['-C', '/promotion', 'merge-base', '--is-ancestor', expected, commit], '');
      await this.git(container, ['-C', '/promotion', 'push', `--force-with-lease=refs/heads/main:${expected}`, this.remote(canonicalRemote), `${commit}:refs/heads/main`], writeToken);
    } finally { await container.destroy(); }
  }
  async build(input: BuildInput): Promise<BuildOutput> {
    const result = await this.buildChecked(input);

    if (!result.ok) throw new Error('Isolated compilation, tests or smoke checks failed');

    return result.output;
  }
  async buildChecked(input: BuildInput): Promise<{ ok: true; output: BuildOutput } | { ok: false; failure: BuildFailure }> {
    const parsed = buildInputSchema.parse(input);
    const container = this.ctx.container;

    if (!container || !container.images.build) throw new Error('Build container image is not configured');

    if (container.running) throw new Error('Sandbox is already occupied');
    container.start({ image: container.images.build, entrypoint: ['sleep', 'infinity'], enableInternet: false });

    try {
      const process = await container.exec(['node', '/runner.mjs'], { stdin: 'pipe', signal: AbortSignal.timeout(180_000), env: {} });

      if (!process.stdin) throw new Error('Missing process input');
      const writer = process.stdin.getWriter();
      await writer.write(new TextEncoder().encode(JSON.stringify(parsed)));
      await writer.close();
      const output = await process.output();

      if (output.exitCode !== 0) return { ok: false, failure: buildFailure(output.exitCode, new Uint8Array(output.stdout), new Uint8Array(output.stderr)) };

      return { ok: true, output: buildOutputSchema.parse(JSON.parse(new TextDecoder().decode(output.stdout))) };
    } finally { await container.destroy(); }
  }
}
