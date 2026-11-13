import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { ApiService } from '../../tooling/api-service';
import { EntityTools } from '../../tooling/entity-tools';
import { createBackup, restoreBackup } from '../../tooling/backup-library';

it('restores private state and Git websites into a new directory, rejecting tampered backup bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arti-backup-'));
  const original = join(root, 'original');
  const backup = join(root, 'backup');
  const restored = join(root, 'restored');
  const service = new ApiService(original);
  await service.initialize();
  const tools = new EntityTools(original, service.execution);
  tools.remember({ role: 'entity', entityId: 'researcher' }, 'source', 'private research note');
  const state = service.getState();
  tools.close();
  service.close();

  try {
    await createBackup(original, backup);
    await restoreBackup(backup, restored);
    const recovered = new ApiService(restored);
    await recovered.initialize();
    const memories = new EntityTools(restored, recovered.execution);

    try {
      expect(recovered.getState()).toEqual(state);
      expect(memories.memory({ role: 'entity', entityId: 'researcher' })[0]?.value).toBe('private research note');
      expect((await recovered.execution.site('collective')).html).toContain('Arti collective');
    } finally { memories.close(); recovered.close(); }

    await writeFile(join(backup, 'world.sqlite'), 'tampered');
    await expect(restoreBackup(backup, join(root, 'bad'))).rejects.toThrow('integrity');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15000);
