import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../../../packages/domain/src/index';
import type { Command, PublicAuthoringScope } from '../../../../packages/contracts/src/index';
import { privateSnapshotSchema } from '../memory/state';
import { createTurnPrivacy } from './privacy';
import { runBoundedTurn } from '../../src/index';
import { publicWriterInstructions, publicWriterModel, publicWriterToolAvailable, publicWriterCommandAvailable, requirePublicWriterCommand, mayReplayPublicWriterCommand } from './public-writer';

const scope: PublicAuthoringScope = { goalId: 'goal-one', taskId: 'task-one', revision: 1, approvalId: 'human-approval-one' };

describe('isolated approved public authoring', () => {
  it('binds collective authorship and command replay to the approved shared project', () => {
    const projectScope = { ...scope, projectId: 'collective' };
    const entity = createInitialState().entities[2]!;
    const instructions = publicWriterInstructions(entity, { scope: projectScope, brief: 'Build one public shared reference.', taskTitle: 'Implement reference', taskStatus: 'running' }, 'schema');
    expect(instructions).toContain('"projectId":"collective"');
    expect(instructions).toContain('shared collective project');
    expect(instructions).toContain('platform selects the canonical repository');
    expect(mayReplayPublicWriterCommand(projectScope, { ...projectScope, projectId: 'other' }, 'public', { type: 'social.post', body: 'Progress' })).toBe(false);
  });
  it('ends after a recorded task submission without further authorization or inference', async () => {
    let inferences = 0;
    let authorizations = 0;
    let submitted = false;

    const model = publicWriterModel({ next: async () => {
      inferences++;

      return { text: 'Submit observed research', calls: [{ name: 'world.command', arguments: 'submit' }] };
    } }, async () => {
      authorizations++;

      if (submitted) throw new Error('Task no longer running');
    }, () => submitted);

    const result = await runBoundedTurn(model, { execute: async () => { submitted = true;

 return 'Submission recorded'; } }, []);

    expect(result.status).toBe('completed');
    expect(inferences).toBe(1);
    expect(authorizations).toBe(1);
  });

  it('rejects revoked approval before model dispatch rather than downgrading to private-context authoring', async () => {
    let inferences = 0;

    const model = publicWriterModel({ next: async () => { inferences++;

 return { text: 'Unexpected', calls: [] }; } }, async () => { throw new Error('Approval replaced'); }, () => false);

    await expect(runBoundedTurn(model, { execute: async () => 'Unexpected' }, [])).rejects.toThrow('Approval replaced');
    expect(inferences).toBe(0);
  });

  it('constructs model input solely from approved DTO fields without serializing private structural extras', () => {
    const entity = createInitialState().entities[2]!;
    const assignment = { scope, brief: 'Create a public guide to checked APIs.', taskTitle: 'Build service', taskStatus: 'running' as const, goal: { objective: 'PRIVATE-GOAL-CANARY' }, confirmations: [{ answer: 'PRIVATE-ANSWER-CANARY' }], dependencyHandoffs: [{ body: 'PRIVATE-HANDOFF-CANARY' }], entries: ['PRIVATE-MEMORY-CANARY'] };
    const instructions = publicWriterInstructions(entity, assignment, 'PUBLIC-COMMAND-SCHEMA');
    const inputs = { instructions, history: createTurnPrivacy(true).history };
    expect(instructions).toContain(assignment.brief);
    expect(instructions).toContain(scope.taskId);
    expect(instructions).toContain('Human independent task review');
    expect(JSON.stringify(inputs)).not.toContain('CANARY');
    expect(inputs.history).toEqual([]);
  });

  it('permits only own task controls and deliberate public posts, without profile or governance powers', () => {
    const allowed: Command[] = [
      { type: 'task.claim', taskId: scope.taskId, expectedRevision: 1 },
      { type: 'task.submit', taskId: scope.taskId, expectedRevision: 1, summary: 'Observed approved public research' },
      { type: 'task.fail', taskId: scope.taskId, expectedRevision: 1, reason: 'Observed build failure' },
      { type: 'social.post', body: 'A checked build has been requested; publication is pending.' },
    ];

    for (const command of allowed) {
      expect(publicWriterCommandAvailable(command.type)).toBe(true);
      expect(() => requirePublicWriterCommand(scope, command)).not.toThrow();
    }

    for (const command of [
      { type: 'budget.configure', dailyUsd: 5 },
      { type: 'entity.profile', name: 'Changed', description: 'Unapproved identity change' },
      { type: 'governance.propose', text: 'Unapproved rule proposal' },
      { type: 'confirmation.request', taskId: scope.taskId, expectedRevision: 1, question: 'Reveal private direction?' },
    ] satisfies Command[]) expect(() => requirePublicWriterCommand(scope, command)).toThrow();
    expect(() => requirePublicWriterCommand(scope, { type: 'task.submit', taskId: 'another-task', expectedRevision: 1, summary: 'Foreign task result' })).toThrow();
    expect(() => requirePublicWriterCommand(scope, { type: 'task.claim', taskId: scope.taskId, expectedRevision: 2 })).toThrow();
  });

  it('offers approved public execution without private application reads or unknown tools', () => {
    for (const tool of ['world.inspect', 'world.command', 'repo.fork', 'repo.read', 'repo.patch_commit', 'execution.request_build', 'research.retrieve', 'research.browser']) expect(publicWriterToolAvailable(tool)).toBe(true);

    for (const tool of ['data.get', 'data.put', 'data.delete', 'memory.read', 'memory.write', 'operator.command', 'unknown.future_tool']) expect(publicWriterToolAvailable(tool)).toBe(false);
  });

  it('quarantines private, legacy and superseded pending commands instead of replaying them into public sessions', () => {
    const command: Command = { type: 'social.post', body: 'Observed public progress' };
    expect(mayReplayPublicWriterCommand(scope, scope, 'public', command)).toBe(true);
    expect(mayReplayPublicWriterCommand(scope, scope, 'private', command)).toBe(false);
    expect(mayReplayPublicWriterCommand(scope, undefined, 'public', command)).toBe(false);
    expect(mayReplayPublicWriterCommand(scope, scope, undefined, command)).toBe(false);

    for (const changed of [{ ...scope, revision: 2 }, { ...scope, goalId: 'other-goal' }, { ...scope, taskId: 'other-task' }, { ...scope, approvalId: 'new-approval' }]) expect(mayReplayPublicWriterCommand(scope, changed, 'public', command)).toBe(false);
    expect(mayReplayPublicWriterCommand(scope, scope, 'public', { type: 'governance.propose', text: 'An unapproved policy' })).toBe(false);
    const restored = privateSnapshotSchema.parse({ entityId: 'builder-1', state: { entries: ['PRIVATE-LOG-CANARY'], running: false, turns: 1, leaseUntil: 0, checkpoint: 0, turnId: null, pendingCommand: { command, key: 'pending-public-key', scope: 'public', authoringScope: scope } } });
    expect(restored.state.pendingCommand?.authoringScope).toEqual(scope);
    expect(mayReplayPublicWriterCommand(scope, restored.state.pendingCommand?.authoringScope, restored.state.pendingCommand?.scope, command)).toBe(true);
  });
});
