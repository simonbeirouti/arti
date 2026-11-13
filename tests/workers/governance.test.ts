/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import type { Command } from '../../packages/contracts/src/index';

async function proposal(name: string) {
  const world = env.WORLD.getByName(name);
  await world.onboardVisitor('hashed-visitor-session', 'Avery', `ip-${name}`);
  const suggestion = await world.submitVisitorSuggestion('hashed-visitor-session', 'Build a useful public calendar', 'visitor-request-1', `ip-${name}`);
  await runInDurableObject(world, async (instance, storage) => {
    const state = instance.inspect();
    state.mode = 'live';
    storage.storage.sql.exec('UPDATE world_snapshot SET value=? WHERE id=1', JSON.stringify(state));
  });
  const review: Command = { type: 'suggestion.review', suggestionId: suggestion.id, brief: 'Build a useful public calendar', criteria: ['A public calendar is visible'], reason: 'Relevant bounded improvement', rejected: false };

  return { world, suggestion, review };
}

it('acknowledges already delivered decisions and discards confirmed stale decisions without duplicate receipts', async () => {
  const { world, review } = await proposal('governance-replay');
  const key = 'visitor-governance-moderator-review';
  const result = await world.governanceCommand('moderator', review, key);
  expect(result?.visitorBuild?.suggestions[0].status).toBe('reviewing');
  const repeated = await world.governanceCommand('moderator', review, key);
  expect(repeated?.receipts.length).toBe(result?.receipts.length);
  expect(await world.governanceCommand('moderator', review, 'visitor-governance-obsolete-review')).toBeNull();
  expect((await world.inspect()).receipts.length).toBe(result?.receipts.length);
});

it('rejects paused and wrong-role transitions without granting operator powers and recovers after resume', async () => {
  const { world, review } = await proposal('governance-pause');
  expect(await world.governanceCommand('builder-1', review, 'visitor-governance-forged-role')).toBeNull();
  await world.command({ role: 'operator' }, { type: 'world.pause', paused: true }, 'operator-pause-world');
  expect(await world.governanceCommand('moderator', review, 'visitor-governance-paused-review')).toBeNull();
  expect((await world.inspect()).visitorBuild?.suggestions[0].status).toBe('pending');
  await world.command({ role: 'operator' }, { type: 'world.pause', paused: false }, 'operator-resume-world');
  expect((await world.governanceCommand('moderator', review, 'visitor-governance-paused-review'))?.visitorBuild?.suggestions[0].status).toBe('reviewing');
});

it('does not acknowledge a storage failure as confirmed command rejection', async () => {
  const { world, review } = await proposal('governance-unknown-delivery');
  await runInDurableObject(world, async instance => {
    // Backup barrier is an actual apply-stage failure after pure domain preflight.
    const state = instance.inspect();
    expect(state.visitorBuild?.suggestions[0].status).toBe('pending');
  });
  await runInDurableObject(world, async (instance, storage) => {
    storage.storage.sql.exec('CREATE TABLE IF NOT EXISTS backup_barrier(id INTEGER PRIMARY KEY,backup TEXT NOT NULL,resume INTEGER NOT NULL)');
    storage.storage.sql.exec('INSERT INTO backup_barrier(id,backup,resume) VALUES(1,?,0)', 'backup-test');
    expect(() => instance.governanceCommand('moderator', review, 'visitor-governance-unknown-review')).toThrow('temporarily frozen');
    expect(instance.inspect().visitorBuild?.suggestions[0].status).toBe('pending');
    storage.storage.sql.exec('DELETE FROM backup_barrier WHERE id=1');
    expect(instance.governanceCommand('moderator', review, 'visitor-governance-unknown-review')?.visitorBuild?.suggestions[0].status).toBe('reviewing');
  });
});
