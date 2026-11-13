import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../../../packages/domain/src/index';
import { LocalExecution } from '../publication/local';
import { createIdentityWorkerSource, createPublicSiteContent, publicSiteContentSchema, renderPersonalSite, publicIdentityPresentation } from './render';

describe('public identity websites', () => {
  it('gives all six identities distinct structures and public personality without model-authorship claims', () => {
    const pages = createInitialState().entities.map((entity) => renderPersonalSite(createPublicSiteContent(entity, 1)));
    const structures = pages.map((page) => /data-studio="([a-z]+)"/.exec(page)?.[1]);
    expect(new Set(structures).size).toBe(6);

    for (const [index, entity] of createInitialState().entities.entries()) {
      expect(pages[index]).toContain(entity.name);
      expect(pages[index]).toContain(entity.personality[0]);
      expect(pages[index]).toContain('SIMULATION');
      expect(pages[index]).toContain('platform template');
      expect(pages[index]).not.toContain('lastActiveAt');
    }
  });
  it('escapes all public text, rejects CSS injection, and accepts legacy content', () => {
    const content = { name: '<script>', description: '"<private>', interests: ['<img>'], version: 2 };
    expect(renderPersonalSite(content)).toContain('&lt;script&gt;');
    expect(renderPersonalSite(content)).not.toContain('<private>');
    expect(() => publicSiteContentSchema.parse({ ...content, color: '#fff; background:url(secret)' })).toThrow();
    expect(() => publicSiteContentSchema.parse({ ...content, memory: 'private' })).toThrow();
  });
  it('upgrades a legacy release through canonical promotion and leaves old immutable bytes unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arti-personal-site-'));
    const entity = createInitialState().entities[0]!;

    try {
      const execution = new LocalExecution(root);
      await execution.initialize([entity]);
      const workspace = await execution.repositories.fork(entity.id, 'legacy');
      await execution.repositories.patch(workspace.path, 'site/content.json', JSON.stringify({ name: 'My authored name', description: 'My preserved contribution', interests: ['My own interest'], version: 2 }));
      await execution.repositories.commit(workspace.path, 'Legacy authored content');
      const legacy = await execution.publishWorkspace(entity, workspace);
      const oldBytes = await readFile(join(root, 'bundles', `${legacy.bundleHash}.html`), 'utf8');
      const restarted = new LocalExecution(root);
      await restarted.initialize([entity]);
      const history = await restarted.deployments(entity.id);
      expect(history).toHaveLength(3);
      expect(history.at(-1)?.commit).not.toBe(legacy.commit);
      const site = await restarted.site(entity.id);
      expect(site.html).toContain('My preserved contribution');
      expect(site.html).toContain('My authored name');
      expect(site.html).toContain('My own interest');
      expect(site.html).toContain('deliberate');
      expect(await readFile(join(root, 'bundles', `${legacy.bundleHash}.html`), 'utf8')).toBe(oldBytes);
      expect(createHash('sha256').update(site.html).digest('hex')).toBe(history.at(-1)?.bundleHash);
      await restarted.initialize([entity]);
      expect(await restarted.deployments(entity.id)).toHaveLength(3);
      expect(await restarted.site(entity.id)).toEqual(site);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('live identity chrome is scoped and escapes identity without inspecting authored content', () => {
    const entity = createInitialState().entities[0]!;
    const chrome = publicIdentityPresentation({ ...entity, name: '<unsafe>', personality: ['<script>'] });
    expect(chrome.header).toContain('&lt;unsafe&gt;');
    expect(chrome.header).toContain('&lt;script&gt;');
    expect(chrome.header).toContain('provided by Arti');
    expect(chrome.style).not.toContain('body{');
    expect(chrome.style).not.toContain('url(');
  });
  it('generated Worker retains trusted jobs and status API while excluding extra entity fields', async () => {
    const entity = createInitialState().entities[2]!;
    const source = createIdentityWorkerSource({ ...entity, description: 'Public builder' }, 3);
    const output = stripTypeScriptTypes(source);
    const module = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
    const fetch = module.default.fetch;
    expect(await (await fetch(new Request('https://entity.invalid/'))).text()).toContain('LIVE HOSTING');
    expect((await fetch(new Request('https://entity.invalid/_arti/jobs/refresh'))).status).toBe(403);
    const stored = new Map<string, string>();
    const context = { props: { APP_DATA: { get: async (key: string) => stored.get(key) ?? null, put: async (key: string, value: string) => { stored.set(key, value); } }, job: { id: 'refresh', scheduledAt: 42 } } };
    expect(await (await fetch(new Request('https://entity.invalid/_arti/jobs/refresh'), undefined, context)).json()).toEqual({ saved: true });
    expect(await (await fetch(new Request('https://entity.invalid/api/status'), undefined, context)).json()).toEqual({ lastRefresh: '42' });
    expect(source).not.toContain('dailyAllowanceUsd');
    expect(source).not.toContain('lastActiveAt');
  });
});
