import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createInitialState, WorldEngine } from '../../../../packages/domain/src/index';
import { LocalExecution } from '../publication/local';
import { dispatch } from '../publication/dispatch';
import { codeScope } from '../cloud-build/code-scope';
import { buildRequestSchema } from '../cloud-build/build-request';
import { approvedAuthoringScope, validateAuthoringScope } from '../cloud-build/authoring-scope';
import { matchingPublication } from '../cloud-build/publication-replay';

it('retires personal website code tools when a shared project is configured', () => {
  const state = createInitialState();
  expect(() => codeScope(state, 'builder-1', 'personal-presence')).toThrow('retired');
  state.projects = [];
  expect(codeScope(state, 'builder-1', 'personal-presence').repoName).toBe('builder-1-personal-presence');
});

it('derives shared repository from trusted assignment while binding public scope to project', () => {
  const state = createInitialState();
  state.mode = 'live';
  state.goals.push({ id: 'goal', projectId: 'collective', status: 'active', revision: 1, revisions: [{ revision: 1, objective: 'PRIVATE_GOAL', criteria: [], constraints: [], createdAt: state.clock, publicBrief: { text: 'Public tool', approvalId: 'approved', approvedAt: state.clock } }], createdAt: state.clock, completedAt: null, feedback: [] });
  state.tasks.push({ id: 'build', projectId: 'collective', entityId: 'builder-1', goalId: 'goal', revision: 1, title: 'PRIVATE_TASK', dependencies: [], status: 'queued', attempts: 0, evidenceIds: [] });
  const scope = codeScope(state, 'builder-1', 'build');
  expect(scope.repoName).toBe('collective-builder-1-build');
  expect(scope.canonicalRepoName).toBe('collective');
  expect(scope.projectId).toBe('collective');
  expect(JSON.stringify(scope)).not.toContain('PRIVATE');
  const authoring = approvedAuthoringScope(state, 'builder-1', 'build');
  expect(authoring.projectId).toBe('collective');
  expect(() => validateAuthoringScope(state, 'builder-1', { ...authoring, projectId: 'other' })).toThrow('superseded');
  expect(() => codeScope(state, 'builder-2', 'build')).toThrow('assigned');
  expect(() => buildRequestSchema.parse({ entityId: 'builder-1', projectId: 'other', repoName: scope.repoName, taskId: 'build', goalId: 'goal', revision: 1, commit: 'a'.repeat(40), authoringScope: authoring })).toThrow();
  state.projects = [];
  expect(() => codeScope(state, 'builder-1', 'build')).toThrow('registered');
});

it('publishes a separate shared local repository and rejects stale concurrent contributor forks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arti-shared-project-'));
  const state = createInitialState();
  const entities = state.entities;
  const execution = new LocalExecution(root, { getProjects: () => state.projects ?? [], validateGoal: () => true });

  try {
    await execution.initialize(entities);
    expect(await execution.deployments('collective')).toHaveLength(1);
    expect(await execution.deployments('builder-1')).toHaveLength(0);
    await expect(access(join(root, 'repositories', 'builder-1'))).rejects.toThrow();
    const first = await execution.site('collective');
    expect(first.html).toContain('One shared workshop');
    expect(first.html).toContain('SIMULATION');
    const a = await execution.repositories.fork('collective', 'collective-a');
    const b = await execution.repositories.fork('collective', 'collective-b');
    const body = { name: 'Our shared project', description: 'Checked contribution', interests: ['Public tool'], version: 2 };
    await execution.repositories.patch(a.path, 'site/content.json', JSON.stringify(body));
    await execution.repositories.commit(a.path, 'Contribution by builder-1');
    await execution.repositories.patch(b.path, 'site/content.json', JSON.stringify({ ...body, description: 'Another contribution' }));
    await execution.repositories.commit(b.path, 'Contribution by builder-2');
    const context = { goalId: 'goal', revision: 1, projectId: 'collective', taskId: 'task-a' };
    const published = await execution.publishWorkspace(entities[2]!, a, context);
    expect(published.entityId).toBe('builder-1');
    expect(published.projectId).toBe('collective');
    await expect(execution.publishWorkspace(entities[3]!, b, { ...context, taskId: 'task-b' })).rejects.toThrow('Canonical');
    expect((await execution.site('collective')).html).toContain('Checked contribution');
    await execution.rollback('collective');
    expect(await execution.site('collective')).toEqual(first);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('dispatches shared showcase only from project receipt and isolates project storage', async () => {
  const world = createInitialState();
  const bundleHash = 'b'.repeat(64);
  const deployment = { id: 'published', entityId: 'builder-1', projectId: 'collective', commit: 'a'.repeat(40), bundleHash, workerName: `collective-${bundleHash}`, version: 1, environment: 'production' as const, status: 'published' as const, createdAt: world.clock };
  world.deployments.push(deployment);
  let selectedStorage = '';

  const response = await dispatch(new Request('https://showcase.invalid/', { headers: { cookie: 'private', authorization: 'secret' } }), { ENTITY_DOMAIN: 'entities.invalid', SHOWCASE_HOSTNAME: 'showcase.invalid', WORLD: { getByName: () => ({ publicState: async () => new WorldEngine(world).getPublicState() }) }, DISPATCH: { get: (name) => {
    expect(name).toBe(`collective-${bundleHash}`);

    return { fetch: async (request) => {
      expect(request.headers.has('cookie')).toBe(false);
      expect(request.headers.has('authorization')).toBe(false);

      return new Response('shared project', { headers: { 'Set-Cookie': 'unsafe' } });
    } };
  } } }, (id) => { selectedStorage = id;

    return { get: async () => null, put: async () => undefined, delete: async () => undefined };
  });

  expect(await response.text()).toBe('shared project');
  expect(response.headers.has('set-cookie')).toBe(false);
  expect(selectedStorage).toBe('collective');
  const request = { entityId: 'builder-1', projectId: 'collective', repoName: 'collective-builder-1-task', commit: deployment.commit, taskId: 'task' };
  world.deployments[0]!.taskId = 'task';
  expect(matchingPublication(world, request, 'published')).toEqual(world.deployments[0]);
  expect(() => matchingPublication(world, { ...request, projectId: 'other' }, 'published')).toThrow('conflicts');
});


it('retires legacy website dispatch in shared mode without deleting deployment history', async () => {
  const state = createInitialState();
  const bundleHash = 'c'.repeat(64);
  state.deployments.push({ id: 'legacy', entityId: 'builder-1', commit: 'a'.repeat(40), bundleHash, workerName: `builder-1-${bundleHash}`, version: 1, environment: 'production', status: 'published', createdAt: state.clock });
  let calls = 0;

  const environment = { ENTITY_DOMAIN: 'entities.invalid', WORLD: { getByName: () => ({ publicState: async () => new WorldEngine(state).getPublicState() }) }, DISPATCH: { get: () => ({ fetch: async () => { calls++;

    return new Response('legacy');
  } }) } };

  expect((await dispatch(new Request('https://builder-1.entities.invalid/'), environment)).status).toBe(404);
  expect(calls).toBe(0);
  expect(state.deployments).toHaveLength(1);
  state.projects = [];

  expect(await (await dispatch(new Request('https://builder-1.entities.invalid/'), environment)).text()).toBe('legacy');
  expect(calls).toBe(1);
});
