/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { WorldDurableObject } from '../../apps/world/src/index';

declare global {
  namespace Cloudflare {
    interface Env { WORLD: DurableObjectNamespace<WorldDurableObject> }
  }
}

it('persists canonical world commands and idempotency across real Durable Object eviction', async () => {
  const world = env.WORLD.getByName('durable-acceptance');
  const command = { type: 'goal.create' as const, objective: 'PRIVATE_WORKER_GOAL', criteria: ['Verify saved state'], constraints: [] };
  const created = await world.command({ role: 'operator' }, command, 'worker-goal-create');
  expect(created.goals).toHaveLength(1);
  await evictDurableObject(world);
  const recovered = await world.inspect();
  expect(recovered).toEqual(created);
  const repeated = await world.command({ role: 'operator' }, command, 'worker-goal-create');
  expect(repeated.goals).toHaveLength(1);
  expect(JSON.stringify(await world.publicState())).not.toContain('PRIVATE_WORKER_GOAL');

  const denied = await runInDurableObject(world, async (instance) => {
    try {
      await instance.command({ role: 'operator' }, { type: 'social.post', body: 'Impersonate an agent' }, 'worker-forged-post');

      return 'unexpected success';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });

  expect(denied).toContain('Entity action');
});

it('recovers a committed terminal public command without authorizing new work', async () => {
  const world = env.WORLD.getByName('public-terminal-replay');
  const created = await world.command({ role: 'operator' }, { type: 'goal.create', objective: 'PRIVATE TERMINAL GOAL', criteria: ['Check persisted evidence'], constraints: [] }, 'public-replay-create');
  const goal = created.goals[0];
  await world.command({ role: 'operator' }, { type: 'goal.public_brief', goalId: goal.id, expectedRevision: 1, text: 'Publish a useful public browser reference with attributed sources.', acknowledgement: 'APPROVE_PUBLIC_AUTHORING' }, 'public-replay-approve');
  await world.command({ role: 'operator' }, { type: 'goal.start', goalId: goal.id }, 'public-replay-start');
  const assignment = await world.ownPublicTask('researcher');

  if (!assignment) throw new Error('Missing public assignment');
  await world.publicCommand('researcher', assignment.scope, { type: 'task.claim', taskId: assignment.scope.taskId, expectedRevision: 1 }, 'public-replay-claim');
  const command = { type: 'task.submit' as const, taskId: assignment.scope.taskId, expectedRevision: 1, summary: 'Public research submitted for independent review' };
  const first = await world.publicCommand('researcher', assignment.scope, command, 'public-terminal-fail');
  const repeated = await world.publicCommand('researcher', assignment.scope, command, 'public-terminal-fail');
  expect(repeated).toEqual(first);

  const conflicts = await runInDurableObject(world, instance => {
    const results = [];

    for (const [entityId, input] of [['builder-1', command], ['researcher', { ...command, summary: 'Different payload' }]] as const) {
      try { instance.publicCommand(entityId, assignment.scope, input, 'public-terminal-fail'); results.push(false); }
      catch { results.push(true); }
    }

    return results;
  });

  expect(conflicts).toEqual([true, true]);
});
