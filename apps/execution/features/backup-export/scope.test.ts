import { expect, it } from 'vitest';
import { createInitialState } from '../../../../packages/domain/src/index';
import { backupStorageTarget } from './scope';

it('resolves registered project repositories independently from entity identity and allowance', () => {
  const state = createInitialState();
  state.projects = [{ id: 'collective', name: 'Shared', description: 'Public', repository: 'shared-code', siteVersion: 0 }];
  expect(backupStorageTarget(state, 'collective')).toEqual({ storageId: 'collective', repositoryName: 'shared-code' });
  expect(backupStorageTarget(state, 'builder-1')).toEqual({ storageId: 'builder-1', repositoryName: 'builder-1' });
  expect(() => backupStorageTarget(state, 'foreign')).toThrow('Unregistered');
  expect(() => backupStorageTarget(state, '../collective')).toThrow('Invalid');
  state.projects[0]!.repository = '../secrets';
  expect(() => backupStorageTarget(state, 'collective')).toThrow('Invalid');
});
