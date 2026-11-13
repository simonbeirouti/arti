import { mkdtemp, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalExecution } from '../../apps/execution/features/publication/local';
import { LocalGitAdapter } from '../../packages/provider-adapters/src/local-git';
import { LiveGate, ResearchAdapter, TrustedUploader } from '../../packages/provider-adapters/src/cloudflare';
import { dispatch } from '../../apps/execution/features/publication/dispatch';
import { WorldEngine } from '../../packages/domain/src/index';
import type { Entity } from '../../packages/contracts/src/index';

const entity: Entity = { id: 'test-builder', name: 'Lumen <script>', role: 'builder', color: '#fff', description: 'Independent builder', personality: ['curious'], interests: ['Testing'], status: 'idle', siteVersion: 1, lastActiveAt: null };

const folders: string[] = [];

afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });

async function folder(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'arti-execution-')); folders.push(path);

 return path; }

describe('execution publication', () => {
  it('builds immutable public content from real Git and survives restart with rollback', async () => {
    const root = await folder();
    const execution = new LocalExecution(root);
    await execution.initialize([entity]);
    const first = await execution.site(entity.id);
    expect(first.html).toContain('Lumen &lt;script&gt;');
    expect(first.html).toContain('SIMULATION');
    expect(first.html).not.toContain('Private agent instructions');
    await execution.publish({ ...entity, description: 'Updated public work' });
    expect((await execution.site(entity.id)).html).toContain('Updated public work');
    const restarted = new LocalExecution(root);
    await restarted.initialize([entity]);
    const rollback = await restarted.rollback(entity.id);
    expect(rollback.status).toBe('rolled_back');
    expect(await restarted.site(entity.id)).toEqual(first);
    const exportPath = join(root, 'entity.bundle');
    await restarted.repositories.export(entity.id, exportPath);
    expect((await readFile(exportPath)).length).toBeGreaterThan(0);
  });
  it('publishes the exact edited workspace commit and retries once per task', async () => {
    const root = await folder();
    const execution = new LocalExecution(root, { validateGoal: () => true });
    await execution.initialize([entity]);
    const workspace = await execution.repositories.fork(entity.id, 'edited-site');
    await execution.repositories.patch(workspace.path, 'site/content.json', JSON.stringify({ name: 'Own website', description: 'Public authored content', interests: ['Publishing'], version: 2 }));
    const commit = await execution.repositories.commit(workspace.path, 'Edit my presence');
    const context = { goalId: 'goal-one', revision: 1, taskId: 'task-one' };
    const deployment = await execution.publishWorkspace(entity, workspace, context);
    expect(deployment.commit).toBe(commit);
    expect((await execution.site(entity.id)).html).toContain('Own website');
    expect(await execution.publishWorkspace(entity, workspace, context)).toEqual(deployment);
    expect(await execution.deployments(entity.id)).toHaveLength(2);
  });
  it('rejects stale goal output and serializes simultaneous publications', async () => {
    const root = await folder();
    const execution = new LocalExecution(root, { validateGoal: (_goalId, revision) => revision === 2 });
    await execution.initialize([entity]);
    await expect(execution.publish(entity, { goalId: 'goal-1', revision: 1 })).rejects.toThrow('stale');
    const results = await Promise.all([execution.publish(entity), execution.publish(entity)]);
    expect(results.map((result) => result.version)).toEqual([2, 3]);
  });
  it('rejects canonical conflicts, traversal, and symlink writes', async () => {
    const root = await folder();
    const git = new LocalGitAdapter(root);
    await git.initialize(entity.id, { 'README.md': 'Original' });
    const task = await git.fork(entity.id, 'task-1');
    await git.patch(task.path, 'README.md', 'Task changes');
    const commit = await git.commit(task.path, 'Task');
    await git.patch(git.path(entity.id), 'README.md', 'Concurrent changes');
    await git.commit(git.path(entity.id), 'Concurrent');
    await expect(git.promote(entity.id, task.path, task.baseCommit, commit)).rejects.toThrow('changed');
    await expect(git.patch(task.path, '../outside', 'oops')).rejects.toThrow('Unsafe');
    await symlink(root, join(task.path, 'escape'));
    await expect(git.patch(task.path, 'escape/file', 'oops')).rejects.toThrow('Symlinks');
  });
});

describe('provider boundaries', () => {
  it('never dispatches live activity without activation and allowance', async () => {
    let reserved = false;
    let executed = false;

    const gate = new LiveGate({ activated: false, dailyAllowanceUsd: 100 }, { reserve: async () => { reserved = true;

 return { id: 'r' }; }, settle: async () => undefined });

    await expect(gate.run('entity', 1, 'model', async () => { executed = true; })).rejects.toThrow('disabled');
    expect(reserved).toBe(false);
    expect(executed).toBe(false);
  });
  it('reserves each repeated provider action independently and preserves unknown costs', async () => {
    const keys: string[] = [];
    const settlements: (number | null)[] = [];

    const gate = new LiveGate({ activated: true, dailyAllowanceUsd: 1 }, {
      reserve: async (_entity, _amount, operation) => { keys.push(operation);

 return { id: operation }; },
      settle: async (_id, actual) => { settlements.push(actual); },
    });

    await gate.run('entity', 0.01, 'model.infer', async () => 'first');
    await gate.run('entity', 0.01, 'model.infer', async () => 'second');
    expect(new Set(keys).size).toBe(2);
    expect(settlements).toEqual([null, null]);
  });
  it('uploads only validated modules without caller-provided bindings', async () => {
    let uploaded = false;
    const gate = new LiveGate({ activated: true, dailyAllowanceUsd: 1 }, { reserve: async () => ({ id: 'r' }), settle: async () => undefined });

    const uploader = new TrustedUploader('account', 'secret', gate, async (_url, options) => {
      expect(options?.method).toBe('PUT');
      expect(options?.body).toBeInstanceOf(FormData);

      if (!(options?.body instanceof FormData)) throw new Error('Missing form');
      const metadata = options.body.get('metadata');

      if (!(metadata instanceof Blob)) throw new Error('Missing metadata');
      expect(JSON.parse(await metadata.text()).bindings).toEqual([]);
      uploaded = true;

      return Response.json({ success: true });
    });

    await uploader.upload('entity', 'staging', { mainModule: 'index.js', modules: [{ name: 'index.js', type: 'application/javascript+module', content: 'export default {}' }] });
    expect(uploaded).toBe(true);
    await expect(uploader.upload('entity', 'staging', { mainModule: '../secret', modules: [{ name: '../secret', type: 'text/plain', content: 'oops' }] })).rejects.toThrow('Invalid');
  });
  it('rejects arbitrary research destinations before fetching', async () => {
    let fetched = false;
    const gate = new LiveGate({ activated: true, dailyAllowanceUsd: 1 }, { reserve: async () => ({ id: 'r' }), settle: async () => undefined });

    const research = new ResearchAdapter(['developers.cloudflare.com'], gate, async () => { fetched = true;

 return new Response('data'); });

    await expect(research.retrieve('entity', 'http://localhost/private')).rejects.toThrow('approved');
    await expect(research.retrieve('entity', 'https://developers.cloudflare.com.evil.invalid/')).rejects.toThrow('approved');
    expect(fetched).toBe(false);
  });
  it('strips operator authentication and cookies in both directions', async () => {
    const world = new WorldEngine().getPublicState();
    world.projects = [];
    const commit = 'a'.repeat(40);
    world.deployments.push({ id: 'deployed', entityId: 'builder', commit, workerName: `builder-${"b".repeat(64)}`, version: 1, environment: 'production', status: 'published', createdAt: new Date().toISOString(), bundleHash: 'b'.repeat(64) });

    const response = await dispatch(new Request('https://builder.entities.invalid/', { headers: { Cookie: 'secret', Authorization: 'Bearer secret', 'Cf-Access-Jwt-Assertion': 'secret' } }), {
      ENTITY_DOMAIN: 'entities.invalid', WORLD: { getByName: () => ({ publicState: async () => world }) }, DISPATCH: { get: (id) => {
        expect(id).toBe(`builder-${"b".repeat(64)}`);

        return { fetch: async (request) => {
          expect(request.headers.has('cookie')).toBe(false);
          expect(request.headers.has('authorization')).toBe(false);
          expect(request.headers.has('cf-access-jwt-assertion')).toBe(false);

          return new Response('public', { headers: { 'Set-Cookie': 'steal=1' } });
        } };
      } },
    });

    expect(response.headers.has('set-cookie')).toBe(false);
  });
});

it('routes only ledger-approved immutable bundles even when one source commit builds different outputs', async () => {
  const world = new WorldEngine().getPublicState();
    world.projects = [];
  const oldCommit = 'a'.repeat(40);
  const oldHash = 'c'.repeat(64);
  const nextHash = 'd'.repeat(64);
  const uploadedScripts = new Set([`builder-${oldHash}`, `builder-${nextHash}`]);
  const request = new Request('https://builder.entities.invalid/');
  const requested: string[] = [];

  const environment = {
    ENTITY_DOMAIN: 'entities.invalid',
    WORLD: { getByName: () => ({ publicState: async () => world }) },
    DISPATCH: { get: (name: string) => {
      expect(uploadedScripts.has(name)).toBe(true);
      requested.push(name);

      return { fetch: async () => new Response(name) };
    } },
  };

  // Uploading a script has no effect without a world deployment record.
  expect((await dispatch(request, environment)).status).toBe(404);
  expect(requested).toHaveLength(0);
  world.deployments.push({ id: 'old', entityId: 'builder', commit: oldCommit, workerName: `builder-${oldHash}`, version: 1, environment: 'production', status: 'published', createdAt: new Date().toISOString(), bundleHash: oldHash });
  expect(await (await dispatch(request, environment)).text()).toBe(`builder-${oldHash}`);
  // A second uploaded bundle from the same source commit cannot alter active routing until its ledger receipt exists.
  expect(await (await dispatch(request, environment)).text()).toBe(`builder-${oldHash}`);
  world.deployments.push({ id: 'next', entityId: 'builder', commit: oldCommit, workerName: `builder-${nextHash}`, version: 2, environment: 'production', status: 'published', createdAt: new Date().toISOString(), bundleHash: nextHash });
  expect(await (await dispatch(request, environment)).text()).toBe(`builder-${nextHash}`);
});
