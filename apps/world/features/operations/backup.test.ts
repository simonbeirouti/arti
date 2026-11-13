import { expect, it } from 'vitest';
import { WorldEngine } from '../../../../packages/domain/src/index';
import { digest, validateCompleteBackup, validateBackupProgress, backupProgressSchema } from './backup';

async function fixture() {
  const world = new WorldEngine().getState();
  world.paused = true;

  const entities = await Promise.all(world.entities.map(async entity => {
    const payload = { entityId: entity.id, state: { entries: ['PRIVATE_MEMORY'], running: false, turns: 0, leaseUntil: 0, checkpoint: 0, turnId: null, pendingCommand: null } };

    return { payload, sha256: await digest(JSON.stringify(payload)) };
  }));

  return { schemaVersion: 2, id: '123', environment: 'staging-domains-and-bindings-v1', createdAt: world.clock, world: JSON.stringify(world), entities, repositories: [] };
}

it('validates complete private memory population and rejects altered payloads before restore', async () => {
  const backup = await fixture();
  expect((await validateCompleteBackup(JSON.stringify(backup), backup.environment)).entities).toHaveLength(8);
  backup.entities[0].payload.state.entries.push('tampered');
  await expect(validateCompleteBackup(JSON.stringify(backup), backup.environment)).rejects.toThrow('checksum');
});

it('rejects environment mismatch and missing entities rather than silently restoring partial world', async () => {
  const backup = await fixture();
  await expect(validateCompleteBackup(JSON.stringify(backup), 'production')).rejects.toThrow('environment');
  backup.entities.pop();
  await expect(validateCompleteBackup(JSON.stringify(backup), backup.environment)).rejects.toThrow('population');
});

it('requires every live entity Git export before a backup is complete', async () => {
  const backup = await fixture();
  const world = JSON.parse(backup.world);
  world.mode = 'live'; world.projects = []; backup.world = JSON.stringify(world);
  await expect(validateCompleteBackup(JSON.stringify(backup), backup.environment)).rejects.toThrow('Git export');
});

it('rejects cross-backup Git or application references inside otherwise valid live checkpoints', async () => {
  const source = await fixture();
  const id = '1791849636000';
  const entityId = source.entities[0].payload.entityId;
  const progress = backupProgressSchema.parse({ schemaVersion: 1, id, createdAt: new Date(Number(id)).toISOString(), environment: source.environment, mode: 'live', entityIds: source.entities.map(entity => entity.payload.entityId), rows: [{ entityId, memory: source.entities[0], repository: { entityId, key: `git-backups/${id}/${entityId}.bundle`, commit: 'a'.repeat(40), sha256: 'b'.repeat(64) }, application: { entityId, key: `app-backups/${id}/${entityId}.json`, sha256: 'c'.repeat(64) } }] });
  const context = { id, environment: source.environment, mode: progress.mode, entityIds: progress.entityIds };
  expect((await validateBackupProgress(progress, context)).rows).toHaveLength(1);
  const row = progress.rows[0];

  if (!row.repository || !row.application) throw new Error('Missing live fixture');
  await expect(validateBackupProgress({ ...progress, rows: [{ ...row, repository: { ...row.repository, key: `git-backups/other/${entityId}.bundle` } }] }, context)).rejects.toThrow('key mismatch');
  await expect(validateBackupProgress({ ...progress, rows: [{ ...row, application: { ...row.application, key: `app-backups/other/${entityId}.json` } }] }, context)).rejects.toThrow('key mismatch');
});
