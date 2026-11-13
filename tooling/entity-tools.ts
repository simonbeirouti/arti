import { approvedAuthoringScope, validateAuthoringScope } from '../apps/execution/features/cloud-build/authoring-scope';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { z } from 'zod';
import type { Actor, Deployment, Entity, WorldState } from '../packages/contracts/src/index';
import type { LocalExecution } from '../apps/execution/src/local';

const workspaceSchema = z.object({ id: z.string(), entityId: z.string(), path: z.string(), baseCommit: z.string(), projectId: z.string().optional(), goalId: z.string().optional(), taskId: z.string().optional(), revision: z.number().int().optional(), approvalId: z.string().optional() });

type Workspace = z.infer<typeof workspaceSchema>;

const recordSchema = z.object({ body: z.string() });

export type Memory = { key: string; value: string };

/** Filesystem paths and storage namespaces are always resolved from the authenticated entity. */
export class EntityTools {
  private readonly database: DatabaseSync;

  constructor(dataRoot: string, private readonly execution: LocalExecution, private readonly getState?: () => WorldState) {
    this.database = new DatabaseSync(join(dataRoot, 'entities.sqlite'));
    this.database.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS memory(entity_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(entity_id,key));
      CREATE TABLE IF NOT EXISTS workspace(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, body TEXT NOT NULL);
    `);
  }

  private entity(actor: Actor): string {
    if (actor.role !== 'entity' || !actor.entityId) throw new Error('Authenticated entity required');

    return actor.entityId;
  }

  memory(actor: Actor): Memory[] {
    const rows = this.database.prepare('SELECT key,value FROM memory WHERE entity_id=? ORDER BY key').all(this.entity(actor));

    return z.array(z.object({ key: z.string(), value: z.string() })).parse(rows);
  }

  remember(actor: Actor, key: string, value: string): Memory[] {
    z.string().min(1).max(100).parse(key);
    z.string().max(16000).parse(value);
    this.database.prepare('INSERT INTO memory VALUES(?,?,?) ON CONFLICT(entity_id,key) DO UPDATE SET value=excluded.value').run(this.entity(actor), key, value);

    return this.memory(actor);
  }

  async createWorkspace(actor: Actor): Promise<Workspace> {
    const entityId = this.entity(actor);
    const id = `task-${randomUUID()}`;
    const state = this.getState?.();
    const task = state?.tasks.find(item => item.entityId === entityId && ['queued', 'running'].includes(item.status) && item.projectId && state.goals.some(goal => goal.id === item.goalId && goal.status === 'active' && goal.revision === item.revision));

    if (state?.projects?.length && !task) throw new Error('An assigned shared project task is required');
    const scope = task && state ? approvedAuthoringScope(state, entityId, task.id) : undefined;
    const project = task?.projectId ? state?.projects?.find(item => item.id === task.projectId) : undefined;

    if (task?.projectId && !project) throw new Error('Shared project not found');
    const fork = await this.execution.repositories.fork(project?.repository ?? entityId, id);
    const workspace = workspaceSchema.parse({ id, entityId, ...fork, projectId: project?.id, goalId: scope?.goalId, taskId: scope?.taskId, revision: scope?.revision, approvalId: scope?.approvalId });
    this.database.prepare('INSERT INTO workspace VALUES(?,?,?)').run(id, entityId, JSON.stringify(workspace));

    return workspace;
  }

  private workspace(actor: Actor, id: string): Workspace {
    const row = this.database.prepare('SELECT body FROM workspace WHERE id=? AND entity_id=?').get(id, this.entity(actor));

    if (!row) throw new Error('Workspace not found for this entity');

    return workspaceSchema.parse(JSON.parse(recordSchema.parse(row).body));
  }

  async patch(actor: Actor, id: string, path: string, content: string): Promise<void> {
    await this.execution.repositories.patch(this.workspace(actor, id).path, path, content);
  }

  async commit(actor: Actor, id: string, message: string): Promise<{ commit: string; diff: string }> {
    z.string().min(1).max(500).parse(message);
    const workspace = this.workspace(actor, id);
    const commit = await this.execution.repositories.commit(workspace.path, message);
    const diff = await this.execution.repositories.diff(workspace.path, workspace.baseCommit);

    return { commit, diff };
  }

  publish(actor: Actor, id: string, entities: Entity[]): Promise<Deployment> {
    const entity = entities.find((item) => item.id === this.entity(actor));

    if (!entity) throw new Error('Entity not found');

    const workspace = this.workspace(actor, id);
    const state = this.getState?.();

    if (state?.projects?.length && !workspace.projectId) throw new Error('Personal website publication is retired');

    if (workspace.projectId && state) {
      if (!workspace.goalId || !workspace.taskId || workspace.revision === undefined || !workspace.approvalId) throw new Error('Shared authoring scope missing');
      validateAuthoringScope(state, entity.id, { projectId: workspace.projectId, goalId: workspace.goalId, taskId: workspace.taskId, revision: workspace.revision, approvalId: workspace.approvalId });
    }

    return this.execution.publishWorkspace(entity, workspace, workspace.projectId ? { projectId: workspace.projectId, goalId: workspace.goalId, revision: workspace.revision, taskId: workspace.taskId } : undefined);
  }

  close(): void {
    this.database.close();
  }
}
