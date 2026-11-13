import { describe, expect, it } from 'vitest';
import type { Command } from '../../../../packages/contracts/src/index';
import { runBoundedTurn } from '../../src/index';
import { privateStateSchema } from '../memory/state';
import { createTurnPrivacy, requireCommandPrivacy, requireExecutionPrivacy, mayReplayCommand, retainPrivateTurnLog, sessionToolAvailable } from './privacy';

const publicCommands: Command[] = [
  { type: 'social.post', body: 'PRIVATE-CANARY' },
  { type: 'entity.profile', name: 'Resident', description: 'PRIVATE-CANARY' },
  { type: 'entity.personality', trait: 'PRIVATE-CANARY', rationale: 'Private supporting text', eventIds: ['public-event'] },
  { type: 'relationship.record', targetId: 'researcher', label: 'PRIVATE-CANARY', eventIds: ['public-event'] },
  { type: 'governance.propose', text: 'PRIVATE-CANARY' },
  { type: 'governance.appeal', text: 'PRIVATE-CANARY' },
  { type: 'governance.moderate', targetId: 'researcher', minutes: 1, reason: 'PRIVATE-CANARY' },
];

const privateCommands: Command[] = [
  { type: 'task.claim', taskId: 'assigned-task', expectedRevision: 1 },
  { type: 'task.submit', taskId: 'assigned-task', expectedRevision: 1, summary: 'PRIVATE-CANARY' },
  { type: 'task.fail', taskId: 'assigned-task', expectedRevision: 1, reason: 'PRIVATE-CANARY' },
  { type: 'confirmation.request', taskId: 'assigned-task', expectedRevision: 1, question: 'PRIVATE-CANARY' },
];

describe('fail-closed model session privacy', () => {
  it('never inherits historical private context and retains its bounded operator log separately', () => {
    const privateLog = ['memory:secret:PRIVATE-CANARY', JSON.stringify({ privateSubmission: 'PRIVATE-CANARY' })];
    const retained = retainPrivateTurnLog(privateLog, ['Observed public result']);
    const personal = createTurnPrivacy(false);
    const assigned = createTurnPrivacy(true);
    expect(personal).toEqual({ privateWork: false, history: [] });
    expect(assigned).toEqual({ privateWork: true, history: [] });
    expect(JSON.stringify(personal)).not.toContain('PRIVATE-CANARY');
    expect(retained).toContain('memory:secret:PRIVATE-CANARY');
    expect(privateLog).toHaveLength(2);
    expect(retainPrivateTurnLog(Array.from({ length: 50 }, () => 'prior'), ['x'.repeat(10_001)])).toHaveLength(50);
    expect(retainPrivateTurnLog([], ['x'.repeat(10_001)])[0]).toHaveLength(10_000);
  });

  it('rejects every public command during private work but keeps private task communication available', () => {
    for (const command of publicCommands) {
      expect(() => requireCommandPrivacy(true, command)).toThrow('public-safe authoring session');
      expect(() => requireCommandPrivacy(false, command)).not.toThrow();
    }

    for (const command of privateCommands) expect(() => requireCommandPrivacy(true, command)).not.toThrow();
    expect(() => requireCommandPrivacy(true, { type: 'budget.configure', dailyUsd: 5 })).toThrow();
  });

  it('blocks private-context publication and external egress even for valid tool payloads', () => {
    for (const tool of ['repo.fork', 'repo.patch_commit', 'execution.request_build', 'data.put', 'data.delete', 'research.retrieve', 'research.browser']) {
      expect(() => requireExecutionPrivacy(true, tool)).toThrow('public-safe authoring session');
      expect(sessionToolAvailable(true, tool)).toBe(false);
      expect(() => requireExecutionPrivacy(false, tool)).not.toThrow();
    }

    for (const tool of ['repo.read', 'data.get']) expect(() => requireExecutionPrivacy(true, tool)).not.toThrow();
    expect(() => requireExecutionPrivacy(true, 'unknown.future_mutation')).toThrow();
  });

  it('quarantines pending public commands with private or legacy origins, including after a goal closes', () => {
    for (const command of publicCommands) {
      expect(mayReplayCommand(false, command, undefined)).toBe(false);
      expect(mayReplayCommand(false, command, 'private')).toBe(false);
      expect(mayReplayCommand(true, command, 'public')).toBe(false);
      expect(mayReplayCommand(false, command, 'public')).toBe(true);
    }

    for (const command of privateCommands) expect(mayReplayCommand(true, command, undefined)).toBe(true);
    const state = privateStateSchema.parse({ entries: [], running: false, turns: 0, leaseUntil: 0, checkpoint: 0, turnId: null, pendingCommand: { command: publicCommands[0], key: 'legacy-pending' } });
    expect(mayReplayCommand(false, state.pendingCommand!.command, state.pendingCommand!.scope)).toBe(false);
    const scoped = privateStateSchema.parse({ ...state, pendingCommand: { ...state.pendingCommand, scope: 'private' } });
    expect(scoped.pendingCommand?.scope).toBe('private');
  });

  it('prevents hostile private-turn public actions before invoking a tool and keeps later personal history empty', async () => {
    const privacy = createTurnPrivacy(true);
    let dispatched = 0;
    const model = { next: async () => ({ text: 'Untrusted request to publish a private canary', calls: [{ name: 'repo.patch_commit', arguments: '{"content":"PRIVATE-CANARY"}' }] }) };

    const result = await runBoundedTurn(model, { execute: async call => {
      requireExecutionPrivacy(privacy.privateWork, call.name);
      dispatched++;

      return 'unexpected dispatch';
    } }, privacy.history);

    expect(result.status).toBe('blocked');
    expect(dispatched).toBe(0);
    const retained = retainPrivateTurnLog(['memory:PRIVATE-CANARY'], result.history);
    expect(JSON.stringify(retained)).toContain('PRIVATE-CANARY');
    expect(createTurnPrivacy(false).history).toEqual([]);
  });
});
