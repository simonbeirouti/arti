import { describe, expect, it } from 'vitest';
import { executionInput } from './execution-tools';
import { PersonalProgress } from './personal-progress';
import { freshSlice, finishSliceCall, runBoundedSlice, sliceStateSchema } from './slices';
import { continuationContext, continuationMatches, requireStateStorage, turnContinuationSchema } from './continuation';
import { privateStateSchema } from '../memory/state';
import { assertTurnLease } from './turn-lease';
import { ToolPermissionError } from './tool-failures';

const taskId = 'personal-builder-1-public-site';

const initial = 'a'.repeat(40);

const edited = 'b'.repeat(40);

const latest = 'c'.repeat(40);

const profile = { id: 'builder-1', name: 'Nova', role: 'builder', personality: ['inventive'] };

const contextInput = { entityId: profile.id, siteVersion: 1, privateWork: false, goals: [], assignment: null };

function savedTurn() {
  return turnContinuationSchema.parse({ id: 'f8d33782-ea85-4b21-a84b-c3c85ea578ba', release: 'd'.repeat(64), context: continuationContext(contextInput), privateWork: false, instructions: 'Public bootstrap only', profile, personal: new PersonalProgress(taskId).checkpoint(), slice: freshSlice() });
}

describe('durable independently invoked turn slices (provider fixtures)', () => {
  it('restores all seven personal stages with one execution per invocation and no repeated forks or reads', async () => {
    let durable = savedTurn();
    let calls = 0;
    const observed: string[] = [];
    const paths: string[] = [];

    for (let invocation = 0; invocation < 7; invocation++) {
      const restored = turnContinuationSchema.parse(JSON.parse(JSON.stringify(durable)));
      const personal = PersonalProgress.restore(restored.personal!);
      let executions = 0;

      const model = personal.model({ next: async history => {
        expect(JSON.stringify(history)).not.toContain('PRIVATE-OPERATOR-MEMORY');
        const action = personal.nextAction()!;
        const args = action.tool === 'repo.patch_commit' ? { ...action.arguments, content: `Small public ${action.arguments.path} improvement`, message: 'Public reference' } : action.arguments;
        calls++;

        return { text: 'Fixture next scoped stage', calls: [{ name: action.tool, arguments: JSON.stringify(args) }] };
      } });

      const result = await runBoundedSlice(model, { execute: async call => {
        executions++;
        personal.require(call.name, call.arguments);
        const args = call.name === 'world.inspect' ? {} : JSON.parse(executionInput(call.name, call.arguments));
        const observation = call.name === 'world.inspect' ? '{}' : call.name === 'repo.fork' ? JSON.stringify({ commit: initial }) : call.name === 'repo.read' ? `Existing public ${args.path}` : call.name === 'repo.patch_commit' ? JSON.stringify({ commit: args.path === 'site/worker.ts' ? edited : latest }) : JSON.stringify({ status: 'queued', workflowId: 'fixture-build' });
        observed.push(call.name);

        if (args.path) paths.push(args.path);
        personal.succeeded(call.name, call.arguments, observation);

        return observation;
      } }, restored.slice, slice => { durable = turnContinuationSchema.parse({ ...restored, personal: personal.checkpoint(), slice }); });

      expect(executions).toBe(1);
      expect(result.state.steps).toBe(invocation + 1);
      expect(durable.id).toBe(restored.id);
      expect(durable.profile).toEqual(profile);
    }

    expect(calls).toBe(7);
    expect(observed).toEqual(['world.inspect', 'repo.fork', 'repo.read', 'repo.read', 'repo.patch_commit', 'repo.patch_commit', 'execution.request_build']);
    expect(paths).toEqual(['site/worker.ts', 'tests/worker.test.mjs', 'site/worker.ts', 'tests/worker.test.mjs']);
    expect(durable.personal?.commit).toBe(latest);
    expect(durable.personal?.queued).toBe(true);
    const memory = privateStateSchema.parse({ entries: ['PRIVATE-OPERATOR-MEMORY'], running: false, turns: 0, leaseUntil: 0, checkpoint: 7, turnId: null, pendingCommand: null, continuation: durable });
    expect(memory.entries).toContain('PRIVATE-OPERATOR-MEMORY');
    expect(JSON.stringify(memory.continuation)).not.toContain('PRIVATE-OPERATOR-MEMORY');
  });

  it('keeps twelve total steps across twelve RPCs, including queued calls without additional inference', async () => {
    let durable = freshSlice();
    let inferences = 0;
    let executions = 0;

    const model = { next: async () => { inferences++;

      return { text: 'Fixture batch', calls: Array.from({ length: 12 }, () => ({ name: 'world.inspect', arguments: '{}' })) }; } };

    for (let index = 0; index < 12; index++) {
      const result = await runBoundedSlice(model, { execute: async () => { executions++;

        return '{}'; } }, durable, state => { durable = sliceStateSchema.parse(JSON.parse(JSON.stringify(state))); });

      expect(result.status).toBe(index === 11 ? 'step_limit' : 'pending');
    }

    expect(inferences).toBe(1);
    expect(executions).toBe(12);
    expect((await runBoundedSlice(model, { execute: async () => { throw new Error('Unreachable'); } }, durable, () => undefined)).status).toBe('step_limit');
    expect(executions).toBe(12);
  });

  it('preserves consecutive failure accounting across restarts and resets only after real success', async () => {
    let durable = freshSlice();
    const model = { next: async () => ({ text: 'Fixture call', calls: [{ name: 'world.inspect', arguments: '{}' }] }) };

    for (const success of [false, false, true, false, false, false]) {
      await runBoundedSlice(model, { execute: async () => { if (!success) throw new Error('PRIVATE-ERROR');

        return '{}'; } }, durable, state => { durable = sliceStateSchema.parse(JSON.parse(JSON.stringify(state))); });
    }

    expect(durable.steps).toBe(6);
    expect(durable.failures).toBe(3);
    expect(JSON.stringify(durable.history)).not.toContain('PRIVATE-ERROR');
    expect((await runBoundedSlice(model, { execute: async () => 'unreachable' }, durable, () => undefined)).status).toBe('blocked');
  });

  it('reconciles an idempotent world command without consuming a second logical step', () => {
    const state = freshSlice();
    state.steps = 1; state.inFlight = { name: 'world.command', arguments: '{"command":"already-delivered"}' };
    finishSliceCall(state, '{"receipt":"same-idempotency-receipt"}');
    expect(state.steps).toBe(1);
    expect(state.inFlight).toBeNull();
    expect(state.history).toHaveLength(1);
  });

  it('never replays ambiguous execution delivery across repeated independent resume attempts', async () => {
    const durable = freshSlice();
    durable.steps = 5; durable.inFlight = { name: 'repo.patch_commit', arguments: '{"content":"possibly-delivered"}' };
    let dispatched = 0;

    for (let attempt = 0; attempt < 2; attempt++) await expect(runBoundedSlice({ next: async () => { dispatched++;

      return { text: 'unreachable', calls: [] }; } }, { execute: async () => { dispatched++;

      return 'unreachable'; } }, sliceStateSchema.parse(JSON.parse(JSON.stringify(durable))), () => undefined)).rejects.toThrow('Ambiguous tool delivery');
    expect(dispatched).toBe(0);
    expect(durable.steps).toBe(5);
    expect(durable.inFlight?.name).toBe('repo.patch_commit');
  });

  it('preserves an in-flight mutation after a transport exception but clears known pre-dispatch failures', async () => {
    let durable = freshSlice();
    let dispatched = 0;
    const model = { next: async () => ({ text: 'Fixture mutation', calls: [{ name: 'repo.patch_commit', arguments: '{}' }] }) };
    await expect(runBoundedSlice(model, { execute: async () => { dispatched++;

      throw new Error('Unknown remote transport outcome'); } }, durable, state => { durable = sliceStateSchema.parse(JSON.parse(JSON.stringify(state))); })).rejects.toThrow('Ambiguous tool delivery');
    expect(durable.inFlight?.name).toBe('repo.patch_commit');
    expect(durable.steps).toBe(1);

    for (let attempt = 0; attempt < 2; attempt++) await expect(runBoundedSlice(model, { execute: async () => { dispatched++;

      return 'unreachable'; } }, durable, () => undefined)).rejects.toThrow('Ambiguous tool delivery');
    expect(dispatched).toBe(1);
    const known = await runBoundedSlice(model, { execute: async () => { throw new ToolPermissionError('Not permitted'); } }, freshSlice(), () => undefined);
    expect(known.state.inFlight).toBeNull();
    expect(known.state.failures).toBe(1);
    expect(known.status).toBe('pending');
  });

  it('invalidates changed goal/privacy/revision/site/release contexts and fences older invocation tokens', () => {
    const saved = savedTurn();
    expect(continuationMatches(saved, continuationContext(contextInput), saved.release)).toBe(true);

    for (const changed of [
      { ...contextInput, privateWork: true }, { ...contextInput, siteVersion: 2 },
      { ...contextInput, goals: [{ id: 'new-goal', revision: 2, status: 'active' }] },
      { ...contextInput, assignment: { id: 'assigned', goalId: 'goal', revision: 2 } },
      { ...contextInput, authoringScope: { goalId: 'goal', revision: 1, taskId: 'assigned', approvalId: 'new-approval' } },
    ]) expect(continuationMatches(saved, continuationContext(changed), saved.release)).toBe(false);
    expect(continuationMatches(saved, saved.context, 'e'.repeat(64))).toBe(false);
    const lease = { turnId: 'slice-two-token', leaseUntil: 1000 };
    expect(() => assertTurnLease(lease, 'slice-one-token', 10)).toThrow();
    expect(() => assertTurnLease(lease, 'slice-two-token', 10)).not.toThrow();
  });

  it('rejects oversized UTF-8/session batches before any dispatch and leaves prior private memory intact', async () => {
    let dispatched = 0;

    const model = { next: async () => { dispatched++;

      return { text: 'unreachable', calls: [] }; } };

    const oversized = { ...freshSlice(), history: ['界'.repeat(70_000)] };
    await expect(runBoundedSlice(model, { execute: async () => { dispatched++;

      return 'unreachable'; } }, oversized, () => undefined)).rejects.toThrow('Slice exceeds durable byte allowance');
    expect(dispatched).toBe(0);
    expect(() => turnContinuationSchema.parse({ ...savedTurn(), instructions: '界'.repeat(90_000) })).toThrow();
    expect(() => requireStateStorage(JSON.stringify({ entries: ['界'.repeat(610_000)] }))).toThrow();
    expect(() => requireStateStorage(JSON.stringify({ entries: ['private memory'], continuation: savedTurn() }))).not.toThrow();
    const batch = { next: async () => ({ text: 'Too many large arguments', calls: Array.from({ length: 12 }, () => ({ name: 'repo.patch_commit', arguments: 'x'.repeat(30_000) })) }) };
    await expect(runBoundedSlice(batch, { execute: async () => { dispatched++;

      return 'unreachable'; } }, freshSlice(), () => undefined)).rejects.toThrow('Slice exceeds durable byte allowance');
    expect(dispatched).toBe(0);
  });
});
