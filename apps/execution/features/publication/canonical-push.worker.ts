import { expect, it, vi } from 'vitest';
import execution from '../../src/index';
import { createInitialState } from '../../../../packages/domain/src/index';
import type { WorldState } from '../../../../packages/contracts/src/index';

function setup(state: WorldState) {
  const inspect = vi.fn(async () => state);
  const create = vi.fn(async () => undefined);
  const get = vi.fn(async () => undefined);

  // SAFETY: This queue fixture exposes precisely the bindings reached by the tested branches;
  // absent reservation/model bindings would fail if acknowledgement attempted paid activity.
  const environment = new Proxy({}, { get(_target, key) {
    if (key === 'PUBLICATION_ENABLED' || key === 'LIVE_ACTIVATED') return 'true';

    if (key === 'DAILY_ALLOWANCE_USD') return '5';

    if (key === 'ARTIFACTS_NAMESPACE') return 'registered-artifacts';

    if (key === 'WORLD') return { getByName: () => ({ inspect }) };

    if (key === 'PUBLICATION') return { create, get };
    throw new Error(`Unexpected paid or unrelated binding access: ${String(key)}`);
  } }) as Parameters<typeof execution.queue>[1];

  const ack = vi.fn();
  const body = { type: 'cf.artifacts.repo.pushed', source: { namespace: 'registered-artifacts', repoName: 'collective' }, payload: { ref: 'refs/heads/main', after: 'a'.repeat(40) } };
  const batch: Parameters<typeof execution.queue>[0] = { queue: 'arti-artifact-events', metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } }, retryAll() {}, ackAll() {}, messages: [{ id: 'push-1', timestamp: new Date(), attempts: 1, body, retry() {}, ack }] };

  return { environment, batch, body, ack, create, get, inspect };
}

it('acknowledges a canonical collective promotion push without starting another workflow or paid operation', async () => {
  const fixture = setup(createInitialState());
  await execution.queue(fixture.batch, fixture.environment);
  expect(fixture.ack).toHaveBeenCalledOnce();
  expect(fixture.inspect).toHaveBeenCalledOnce();
  expect(fixture.create).not.toHaveBeenCalled();
  expect(fixture.get).not.toHaveBeenCalled();
});

it('requires the registered namespace and a valid main-branch pushed commit before canonical acknowledgement', async () => {
  const fixture = setup(createInitialState());
  fixture.body.source.namespace = 'untrusted-artifacts';
  await expect(execution.queue(fixture.batch, fixture.environment)).rejects.toThrow('namespace');
  expect(fixture.inspect).not.toHaveBeenCalled();
  expect(fixture.ack).not.toHaveBeenCalled();
  fixture.body.source.namespace = 'registered-artifacts';
  fixture.body.payload.after = 'forged-commit';
  await expect(execution.queue(fixture.batch, fixture.environment)).rejects.toThrow();
  expect(fixture.inspect).not.toHaveBeenCalled();
  expect(fixture.ack).not.toHaveBeenCalled();
});

it('rejects unknown or prefix-only repository names without acknowledgement', async () => {
  for (const repoName of ['unregistered', 'collective-unregistered']) {
    const fixture = setup(createInitialState());
    fixture.body.source.repoName = repoName;
    await expect(execution.queue(fixture.batch, fixture.environment)).rejects.toThrow('Unregistered entity repository');
    expect(fixture.ack).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  }
});

it('keeps scoped task-fork push delivery on its existing checked publication workflow', async () => {
  const state = createInitialState(); state.mode = 'live';
  state.goals.push({ id: 'goal', projectId: 'collective', revision: 1, status: 'active', revisions: [{ revision: 1, objective: 'Private task objective', criteria: ['A checked result'], constraints: [], createdAt: state.clock, publicBrief: { text: 'Build a useful public calendar', approvalId: 'approved-public-brief', approvedAt: state.clock } }], createdAt: state.clock, completedAt: null, feedback: [] });
  state.tasks.push({ id: 'task', entityId: 'builder-1', goalId: 'goal', projectId: 'collective', revision: 1, title: 'Build service', status: 'running', dependencies: [], attempts: 1, evidenceIds: [] });
  const fixture = setup(state);
  fixture.body.source.repoName = 'collective-builder-1-task';
  await execution.queue(fixture.batch, fixture.environment);
  expect(fixture.create).toHaveBeenCalledOnce();
  expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({ id: `collective-builder-1-${'a'.repeat(40)}`, params: expect.objectContaining({ entityId: 'builder-1', projectId: 'collective', repoName: 'collective-builder-1-task', taskId: 'task', goalId: 'goal', revision: 1, authoringScope: expect.objectContaining({ approvalId: 'approved-public-brief' }) }) }));
  expect(fixture.ack).toHaveBeenCalledOnce();
});
