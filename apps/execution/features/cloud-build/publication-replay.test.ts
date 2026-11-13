import { expect, it } from 'vitest';
import { createInitialState } from '../../../../packages/domain/src/index';
import { type Deployment } from '../../../../packages/contracts/src/index';
import { type BuildRequest } from './build-request';
import { matchingPublication, needsBuildEvidenceRecovery, publishOrReplay } from './publication-replay';

it('replays an accepted publication without provider calls after the authoring scope is revoked', async () => {
  const state = createInitialState();
  state.mode = 'live';
  state.paused = true;
  state.goals.push({ id: 'goal', status: 'active', revision: 2, revisions: [], createdAt: state.clock, completedAt: null, feedback: [] });
  state.tasks.push({ id: 'task', entityId: 'builder-1', goalId: 'goal', revision: 1, title: 'Old task', status: 'submitted', dependencies: [], attempts: 1, evidenceIds: [] });
  const hash = 'b'.repeat(64);
  const request: BuildRequest = { entityId: 'builder-1', repoName: 'builder-1-task', taskId: 'task', commit: 'a'.repeat(40), goalId: 'goal', revision: 1, authoringScope: { goalId: 'goal', revision: 1, taskId: 'task', approvalId: 'revoked-approval' } };
  const deployment: Deployment = { id: 'saved-publication', entityId: request.entityId, taskId: request.taskId, goalId: request.goalId, revision: request.revision, commit: request.commit, bundleHash: hash, workerName: `builder-1-${hash}`, version: 1, environment: 'production', status: 'published', createdAt: state.clock };
  state.deployments.push(deployment);
  let uploads = 0;
  let recoveries = 0;

  const result = await publishOrReplay(state, request, deployment.id, hash, async () => { uploads++;

    throw new Error('Revoked scope must never upload'); }, async () => { if (needsBuildEvidenceRecovery(state, request, 'evidence')) recoveries++; });

  expect(result).toEqual(deployment);
  expect(uploads).toBe(0);
  expect(recoveries).toBe(0);
  expect(() => matchingPublication(state, request, deployment.id, 'c'.repeat(64))).toThrow('conflicts');
  expect(() => matchingPublication(state, { ...request, taskId: 'foreign-task' }, deployment.id, hash)).toThrow('conflicts');
  state.paused = false;
  state.goals[0].revision = 1;
  state.tasks[0].status = 'running';
  expect(needsBuildEvidenceRecovery(state, request, 'evidence')).toBe(true);
});
