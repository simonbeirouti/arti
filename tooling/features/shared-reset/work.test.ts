import { expect, it, vi } from 'vitest';
import { archiveAndClearSharedWork, type ResetWorkDependencies } from './work';
import type { PrivateSnapshot } from '../../../apps/agent-runtime/features/memory/state';

const resetId = '11111111-1111-4111-8111-111111111111';

function fixture() {
  let snapshot: PrivateSnapshot = { entityId: 'builder-1', state: { entries: ['PRIVATE_MEMORY_RETAINED'], turns: 12, running: false, leaseUntil: 0, checkpoint: 9, turnId: 'old-turn', pendingCommand: { command: { type: 'world.pause', paused: true }, key: 'old-delivery' }, governancePending: { command: { type: 'suggestion.select' }, key: 'visitor-governance-old' } } };
  let saved: Awaited<ReturnType<ResetWorkDependencies['read']>> = null;

  const dependencies: ResetWorkDependencies = {
    authorize: vi.fn(async () => undefined),
    read: vi.fn(async () => saved),
    create: vi.fn(async (_key, text, metadata) => { saved ??= { text, ...metadata }; }),
    export: vi.fn(async () => structuredClone(snapshot)),
    import: vi.fn(async value => { snapshot = structuredClone(value); }),
  };

  return { dependencies, current: () => snapshot, saved: () => saved };
}

it('archives private delivery state before clearing stale work and preserves memory and turn history', async () => {
  const run = fixture();
  const archive = await archiveAndClearSharedWork(resetId, 'builder-1', run.dependencies);
  expect(archive.key).toBe(`private-shared-resets/${resetId}/entities/builder-1.json`);
  expect(archive.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.parse(run.saved()!.text).state.pendingCommand.key).toBe('old-delivery');
  expect(run.current().state).toMatchObject({ entries: ['PRIVATE_MEMORY_RETAINED'], turns: 12, continuation: null, pendingCommand: null, governancePending: null, checkpoint: 0, turnId: null, running: false, leaseUntil: 0 });
});

it('replays an existing verified archive without replacing it with already-cleared state', async () => {
  const run = fixture();
  const first = await archiveAndClearSharedWork(resetId, 'builder-1', run.dependencies);
  const second = await archiveAndClearSharedWork(resetId, 'builder-1', run.dependencies);
  expect(second).toEqual(first);
  expect(run.dependencies.export).toHaveBeenCalledTimes(1);
  expect(run.dependencies.create).toHaveBeenCalledTimes(1);
  expect(run.current().state.entries).toEqual(['PRIVATE_MEMORY_RETAINED']);
});

it('does not clear memory when archive persistence or integrity verification fails', async () => {
  const run = fixture();
  run.dependencies.create = vi.fn(async () => undefined);
  await expect(archiveAndClearSharedWork(resetId, 'builder-1', run.dependencies)).rejects.toThrow('Verified private');
  expect(run.dependencies.import).not.toHaveBeenCalled();
  run.dependencies.read = vi.fn(async () => ({ text: '{}', sha256: 'a'.repeat(64), resetId, entityId: 'builder-1' }));
  await expect(archiveAndClearSharedWork(resetId, 'builder-1', run.dependencies)).rejects.toThrow('Verified private');
  expect(run.dependencies.import).not.toHaveBeenCalled();
});

it('rechecks canonical reset authority after persistence before importing the cleared work state', async () => {
  const run = fixture();
  run.dependencies.authorize = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Reset window changed'));
  await expect(archiveAndClearSharedWork(resetId, 'builder-1', run.dependencies)).rejects.toThrow('Reset window changed');
  expect(run.saved()).not.toBeNull();
  expect(run.dependencies.import).not.toHaveBeenCalled();
});
