import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { EntityTools } from '../../tooling/entity-tools';
import { ApiService } from '../../tooling/api-service';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function createService(): Promise<ApiService> {
  const root = await mkdtemp(join(tmpdir(), 'arti-publication-auth-'));
  const service = new ApiService(root);
  cleanups.push(async () => { service.close(); await rm(root, { recursive: true, force: true }); });
  await service.initialize();

  return service;
}

it('rejects paused publication before invoking any filesystem or Git side effect', async () => {
  const service = await createService();
  await service.command({ role: 'operator' }, { type: 'world.pause', paused: true }, 'pause-before-publication');
  let invoked = false;
  await expect(service.publishEntity({ role: 'entity', entityId: 'builder-1' }, async entities => {
    invoked = true;

    return service.execution.publish(entities[2]);
  })).rejects.toThrow('paused');
  expect(invoked).toBe(false);
  expect(service.getState().deployments).toHaveLength(1);
});

it('rejects an operator using entity publication tools before source execution', async () => {
  const service = await createService();
  let invoked = false;
  await expect(service.publishEntity({ role: 'operator' }, async entities => {
    invoked = true;

    return service.execution.publish(entities[2]);
  })).rejects.toThrow('Authenticated entity');
  expect(invoked).toBe(false);
});

it('rejects literal private goal text before promoting the collective site', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arti-shared-privacy-'));
  const service = new ApiService(root);
  const tools = new EntityTools(root, service.execution, () => service.getState());
  cleanups.push(async () => { tools.close(); service.close(); await rm(root, { recursive: true, force: true }); });
  await service.initialize();
  const objective = 'Private acquisition target amber orchard';
  const created = await service.command({ role: 'operator' }, { type: 'goal.create', objective, criteria: ['Publish approved public content'], constraints: [] }, 'create-private-goal');
  const goalId = created.goals[0].id;
  await service.command({ role: 'operator' }, { type: 'goal.start', goalId }, 'start-private-goal');
  await service.command({ role: 'operator' }, { type: 'goal.public_brief', goalId, expectedRevision: 1, text: 'Create a safe public resource from fixture content.', acknowledgement: 'APPROVE_PUBLIC_AUTHORING' }, 'approve-safe-shared-brief');
  const actor = { role: 'entity' as const, entityId: 'researcher' };
  const initial = await service.execution.site('collective');
  const workspace = await tools.createWorkspace(actor);
  await tools.patch(actor, workspace.id, 'site/content.json', JSON.stringify({ name: 'Arti collective', description: objective, interests: ['Public resource'], version: 2 }));
  await tools.commit(actor, workspace.id, 'Attempt unsafe public content');
  await expect(service.publishEntity(actor, entities => tools.publish(actor, workspace.id, entities))).rejects.toThrow('private goal');
  expect(await service.execution.site('collective')).toEqual(initial);
});
