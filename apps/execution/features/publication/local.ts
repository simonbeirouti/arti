import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, access, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { z } from 'zod';
import type { Deployment, Entity, SharedProject } from '../../../../packages/contracts/src/index';
import { createPublicSiteContent, publicSiteContentSchema, renderPersonalSite } from '../entity-sites/render';
import { renderSharedProject } from '../shared-project/render';
import { LocalGitAdapter, safeId } from '../../../../packages/provider-adapters/src/local-git';

const contentSchema = publicSiteContentSchema;

const deploymentSchema = z.object({ id: z.string(), entityId: z.string(), commit: z.string().regex(/^[a-f0-9]{40}$/), version: z.number(), environment: z.literal('simulation'), status: z.enum(['published', 'rolled_back']), createdAt: z.string(), bundleHash: z.string().regex(/^[a-f0-9]{64}$/), goalId: z.string().optional(), revision: z.number().optional(), taskId: z.string().optional(), projectId: z.string().optional() });

type Context = { goalId?: string; revision?: number; taskId?: string; projectId?: string };

type LocalDeployment = Deployment & { taskId?: string };

type Options = { localStatic?: boolean; getProjects?: () => SharedProject[]; now?: () => string; validateGoal?: (goalId: string, revision: number) => boolean; validatePublicText?: (text: string) => void };

export class LocalExecution {
  readonly repositories: LocalGitAdapter;
  private readonly locks = new Map<string, Promise<void>>();
  constructor(readonly root: string, private readonly options: Options = {}) { this.repositories = new LocalGitAdapter(root); }
  private now(): string { return this.options.now?.() ?? new Date().toISOString(); }
  private async serialized<T>(entityId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(entityId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    const held = next.then(() => undefined, () => undefined);
    this.locks.set(entityId, held);

    try { return await next; } finally { if (this.locks.get(entityId) === held) this.locks.delete(entityId); }
  }
  private async history(entityId: string): Promise<LocalDeployment[]> {
    try { return z.array(deploymentSchema).parse(JSON.parse(await readFile(join(this.root, 'deployments', `${safeId(entityId)}.json`), 'utf8'))); }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []; throw error; }
  }
  private async save(entityId: string, history: LocalDeployment[]): Promise<void> {
    const folder = join(this.root, 'deployments');
    await mkdir(folder, { recursive: true });
    const target = join(folder, `${safeId(entityId)}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(history, null, 2));
    await rename(temporary, target);
  }
  async initialize(entities: Entity[]): Promise<void> {
    const projects = this.options.getProjects?.() ?? [];

    if (projects.length) {
      const contributor = entities[0];

      if (!contributor) throw new Error('Shared project requires a registered contributor');

      for (const project of projects) {
        await this.repositories.initialize(project.repository, { 'README.md': `# ${project.name}\nShared project repository. Simulation only.\n`, 'site/content.json': JSON.stringify(this.projectContent(project, 1)), 'catalog/README.md': 'Shared project capability and workflow references.\n' });

        if (!(await this.history(project.id)).length) await this.publish(contributor, { projectId: project.id });
      }

      return;
    }

    for (const entity of entities) {
      const content = this.content(entity, 1);
      await this.repositories.initialize(entity.id, {
        'README.md': `# ${entity.name}\nIndependent Arti entity repository. Simulation only.\n`,
        'entity.json': JSON.stringify({ id: entity.id, name: entity.name }),
        'agent/instructions.md': 'Private agent instructions. Never include this directory in publication.\n',
        'agent/personality.json': JSON.stringify(entity.personality),
        'site/content.json': JSON.stringify(content),
        'services/README.md': 'Services require isolated cloud builds before live publication.\n',
        'catalog/README.md': 'Capability and workflow stable IDs belong here.\n',
      });

      if (!(await this.history(entity.id)).length) await this.publish(entity);
      else await this.upgradeIdentityTemplate(entity);
    }
  }
  private project(entity: Entity, context?: Context): SharedProject | undefined {
    if (!context?.projectId) return undefined;
    const project = this.options.getProjects?.().find(item => item.id === context.projectId);

    if (!project) throw new Error('Unregistered shared project');
    safeId(project.id);
    safeId(project.repository);
    safeId(entity.id);

    return project;
  }
  private projectContent(project: SharedProject, version: number): z.infer<typeof contentSchema> {
    return contentSchema.parse({ name: project.name, description: project.description, interests: ['Shared codebase', 'Checked contributions', 'Public services'], version });
  }
  private content(entity: Entity, version: number): z.infer<typeof contentSchema> {
    return createPublicSiteContent(entity, version);
  }
  /** One-time checked migration; published bytes are never changed by serving a site. */
  private async upgradeIdentityTemplate(entity: Entity): Promise<void> {
    await this.serialized(entity.id, async () => {
      const history = await this.history(entity.id);
      const canonical = this.repositories.path(entity.id);
      const currentCommit = await this.repositories.head(canonical);
      const existing = contentSchema.parse(JSON.parse(await this.repositories.read(canonical, currentCommit, 'site/content.json')));

      if (existing.designVersion === 1) return;
      const version = history.length + 1;
      const workspace = await this.repositories.fork(entity.id, `identity-${randomUUID()}`);
      const content = { ...this.content(entity, version), ...existing, version, designVersion: 1 };
      await this.repositories.patch(workspace.path, 'site/content.json', JSON.stringify(content));
      const commit = await this.repositories.commit(workspace.path, 'Apply public identity website template');
      await this.publishPrepared(entity, workspace, commit, history, version);
    });
  }
  async publish(entity: Entity, context?: Context): Promise<Deployment> {
    const project = this.project(entity, context);
    const targetId = project?.id ?? entity.id;

    return this.serialized(targetId, async () => {
      this.validate(context);
      const history = await this.history(targetId);

      if (context?.taskId) {
        const existing = history.find((deployment) => deployment.taskId === context.taskId && deployment.goalId === context.goalId && deployment.revision === context.revision);

        if (existing && !this.options.localStatic) return existing;
      }

      const version = history.length + 1;
      const workspace = await this.repositories.fork(project?.repository ?? entity.id, `build-${randomUUID()}`);
      await this.repositories.patch(workspace.path, 'site/content.json', JSON.stringify(project ? this.projectContent(project, version) : this.content(entity, version)));
      const commit = await this.repositories.commit(workspace.path, `Publish public presence ${version}`);

      return this.publishPrepared(entity, workspace, commit, history, version, context);
    });
  }
  async publishWorkspace(entity: Entity, workspace: { path: string; baseCommit: string }, context?: Context): Promise<Deployment> {
    const project = this.project(entity, context);
    const targetId = project?.id ?? entity.id;

    return this.serialized(targetId, async () => {
      this.validate(context);
      const allowed = await realpath(join(this.root, 'workspaces'));
      const actual = await realpath(workspace.path);

      if (!actual.startsWith(allowed + sep)) throw new Error('Workspace is outside execution root');
      const history = await this.history(targetId);

      if (context?.taskId) {
        const existing = history.find((deployment) => deployment.taskId === context.taskId && deployment.goalId === context.goalId && deployment.revision === context.revision);

        if (existing && !this.options.localStatic) return existing;
      }

      const commit = await this.repositories.head(actual);

      return this.publishPrepared(entity, workspace, commit, history, history.length + 1, context);
    });
  }
  private async publishPrepared(entity: Entity, workspace: { path: string; baseCommit: string }, commit: string, history: LocalDeployment[], version: number, context?: Context): Promise<Deployment> {
      const content = contentSchema.parse(JSON.parse(await this.repositories.read(workspace.path, commit, 'site/content.json')));

      for (const text of [content.name, content.description, content.role ?? '', ...content.interests, ...content.personality ?? []]) this.options.validatePublicText?.(text);
      const project = this.project(entity, context);
      const targetId = project?.id ?? entity.id;
      const html = this.options.localStatic && context?.taskId ? await this.repositories.read(workspace.path, commit, 'site/index.html') : project ? renderSharedProject(content) : renderPersonalSite(content);
      this.options.validatePublicText?.(html);

      if (this.options.localStatic && context?.taskId && (!/^<!doctype html>/i.test(html.trim()) || !/<title[\s>]/i.test(html) || !/<main[\s>]/i.test(html) || /<(?:script|iframe|object|embed|form|base)[\s>]/i.test(html) || /<meta\b[^>]*\bhttp-equiv\s*=/i.test(html))) throw new Error('Local static document check failed');

      if (!/<main[\s>]/i.test(html) || !html.trim().endsWith('</html>')) throw new Error('Static smoke check failed');
      const bundleHash = createHash('sha256').update(html).digest('hex');
      const bundles = join(this.root, 'bundles');
      await mkdir(bundles, { recursive: true });
      const bundle = join(bundles, `${bundleHash}.html`);

      try { await writeFile(bundle, html, { flag: 'wx', mode: 0o444 }); } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }

      this.validate(context);
      await this.repositories.promote(project?.repository ?? entity.id, workspace.path, workspace.baseCommit, commit);
      const deployment: LocalDeployment = { id: `deployment-${randomUUID()}`, entityId: entity.id, commit, version, environment: 'simulation', status: 'published', createdAt: this.now(), bundleHash };

      if (project) deployment.projectId = project.id;

      if (this.options.localStatic && context?.taskId) deployment.authorship = 'agent';

      if (context) { deployment.goalId = context.goalId; deployment.revision = context.revision;

 if (context.taskId) deployment.taskId = context.taskId; }

      history.push(deployment);
      await this.save(targetId, history);

      return deployment;
  }
  private validate(context?: Context): void {
    if (context?.goalId && (!this.options.validateGoal || !this.options.validateGoal(context.goalId, context.revision ?? 0))) throw new Error('Goal is stale, paused or no longer active');
  }
  deployments(entityId: string): Promise<Deployment[]> { return this.history(entityId); }
  async site(entityId: string): Promise<{ html: string; commit: string }> {
    const deployment = (await this.history(entityId)).at(-1);

    if (!deployment) throw new Error('Entity has no deployment');
    const html = await readFile(join(this.root, 'bundles', `${deployment.bundleHash}.html`), 'utf8');

    if (createHash('sha256').update(html).digest('hex') !== deployment.bundleHash) throw new Error('Bundle integrity check failed');

    return { html, commit: deployment.commit };
  }
  async rollback(entityId: string): Promise<Deployment> {
    return this.serialized(entityId, async () => {
      const history = await this.history(entityId);
      const previous = history.at(-2);

      if (!previous) throw new Error('No previous deployment');
      await access(join(this.root, 'bundles', `${previous.bundleHash}.html`));
      const deployment: Deployment = { id: `deployment-${randomUUID()}`, entityId: previous.entityId, commit: previous.commit, bundleHash: previous.bundleHash, environment: 'simulation', version: history.length + 1, status: 'rolled_back', createdAt: this.now() };

      if (previous.projectId) deployment.projectId = previous.projectId;
      history.push(deployment);
      await this.save(entityId, history);

      return deployment;
    });
  }
}
