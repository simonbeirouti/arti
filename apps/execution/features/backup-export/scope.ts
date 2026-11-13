import type { WorldState } from '../../../../packages/contracts/src/index';

/** IDs are storage owners, never authenticated actors; world authorizes the backup barrier. */
export function backupStorageTarget(state: WorldState, targetId: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(targetId)) throw new Error('Invalid backup storage owner');
  const project = state.projects?.find(item => item.id === targetId);

  if (project) {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(project.repository)) throw new Error('Invalid registered project repository');

    return { storageId: project.id, repositoryName: project.repository };
  }

  if (!state.entities.some(entity => entity.id === targetId)) throw new Error('Unregistered backup storage owner');

  return { storageId: targetId, repositoryName: targetId };
}
