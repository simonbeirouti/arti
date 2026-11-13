import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiService } from '../../tooling/api-service';
import { EntityTools } from '../../tooling/entity-tools';

describe('persistent local world integration', () => {
  it('connects goal evidence to real Git publications and recovers after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arti-world-'));
    let service = new ApiService(root);

    try {
      await service.initialize();
      const created = await service.command({ role: 'operator' }, { type: 'goal.create', objective: 'PRIVATE_OBJECTIVE_never_publish', criteria: ['Publish a useful resource'], constraints: [] }, 'create-goal-001');
      const goal = created.goals[0];

      if (!goal) throw new Error('Goal not created');

      await service.command({ role: 'operator' }, { type: 'goal.start', goalId: goal.id }, 'start-goal-001');

      for (let index = 0; index < 16; index += 1) await service.command({ role: 'system' }, { type: 'world.tick' }, `advance-turn-${index}`);

      const state = service.getState();
      expect(state.goals[0]?.status).toBe('awaiting_acceptance');
      expect(state.evidence.length).toBeGreaterThan(0);
      expect(state.evidence.every((evidence) => evidence.deploymentId && /^[a-f0-9]{40}$/u.test(evidence.sourceCommit))).toBe(true);
      expect(JSON.stringify(service.getPublicState())).not.toContain('PRIVATE_OBJECTIVE_never_publish');
      expect(state.budget.spentUsd).toBe(0);
      service.close();
      service = new ApiService(root);
      expect(service.getState()).toEqual(state);
      const accepted = await service.command({ role: 'operator' }, { type: 'goal.control', goalId: goal.id, expectedRevision: 1, action: 'accept', feedback: '' }, 'accept-goal-001');
      expect(accepted.goals[0]?.status).toBe('completed');
    } finally {
      service.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it('scopes memory and code workspaces to the authenticated entity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arti-tools-'));
    const service = new ApiService(root);
    await service.initialize();
    const tools = new EntityTools(root, service.execution, () => service.getState());
    const first = { role: 'entity' as const, entityId: 'researcher' };
    const second = { role: 'entity' as const, entityId: 'builder-2' };

    try {
      tools.remember(first, 'experience', 'private memory');
      expect(tools.memory(second)).toEqual([]);
      expect(() => tools.memory({ role: 'operator' })).toThrow();
      const created = await service.command({ role: 'operator' }, { type: 'goal.create', objective: 'PRIVATE workspace example', criteria: ['Check saved public output'], constraints: [] }, 'create-workspace-goal');
      const goalId = created.goals[0].id;
      await service.command({ role: 'operator' }, { type: 'goal.start', goalId }, 'start-workspace-goal');
      await service.command({ role: 'operator' }, { type: 'goal.public_brief', goalId, expectedRevision: 1, text: 'Create one small shared resource from public fixture content.', acknowledgement: 'APPROVE_PUBLIC_AUTHORING' }, 'approve-workspace-public');
      const workspace = await tools.createWorkspace(first);
      await expect(tools.patch(second, workspace.id, 'content/page.md', 'intrusion')).rejects.toThrow('not found');
      await tools.patch(first, workspace.id, 'content/page.md', 'My first public resource');
      const result = await tools.commit(first, workspace.id, 'Write a public resource');
      expect(result.diff).toContain('My first public resource');
      const deployed = await tools.publish(first, workspace.id, service.getState().entities);
      expect(deployed.environment).toBe('simulation');
      expect(deployed.projectId).toBe('collective');
      expect(deployed.commit).toBe(result.commit);
    } finally {
      tools.close();
      service.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
