import { describe, expect, it } from 'vitest';
import { WorldEngine, createInitialState, parseWorldState } from './index';
import type { Command } from '../../contracts/src/index';

const operator = { role: 'operator' as const };

function create(engine: WorldEngine): string {
  const state = engine.dispatch(operator, { type: 'goal.create', objective: 'PRIVATE build knowledge resource', criteria: ['Useful public guide', 'Working API'], constraints: [] }, 'create-goal');

  return state.goals[0]?.id ?? '';
}

function started() {
  const engine = new WorldEngine(); const id = create(engine); engine.dispatch(operator, { type: 'goal.start', goalId: id }, 'start-goal');

 return { engine, id };
}

function tick(engine: WorldEngine, count = 10): void { for (let index = 0; index < count; index += 1) engine.dispatch(operator, { type: 'world.tick' }, `tick-${engine.getState().turn}-${index}`); }

describe('authoritative world', () => {
  it('seeds stable identities, fixed terms, and zero paid allowance', () => {
    const state = createInitialState(); expect(state.entities).toHaveLength(8); expect(state.appointments).toHaveLength(2); expect(state.mode).toBe('simulation'); expect(state.budget.dailyUsd).toBe(0);
  });
  it('finishes DAG with criterion evidence and human acceptance', () => {
    const { engine, id } = started(); tick(engine);
    const state = engine.getState(); expect(state.goals[0]?.status).toBe('awaiting_acceptance'); expect(state.tasks.every(task => task.status === 'verified')).toBe(true);
    expect(state.evidence.every(run => run.environment === 'simulation')).toBe(true);
    expect(engine.dispatch(operator, { type: 'goal.control', goalId: id, expectedRevision: 1, action: 'accept', feedback: '' }, 'accept-goal').goals[0]?.status).toBe('completed');
  });
  it('does not leak private goal or internal events publicly', () => {
    const { engine } = started(); tick(engine); expect(JSON.stringify(engine.getPublicState())).not.toContain('PRIVATE'); expect(engine.getPublicState().events.every(event => event.visibility === 'public')).toBe(true);
  });
  it('blocks human social actions and forged entity identities', () => {
    const engine = new WorldEngine(); expect(() => engine.dispatch(operator, { type: 'social.post', body: 'hello' }, 'human-post')).toThrow('Entity action');
    expect(() => engine.dispatch({ role: 'entity', entityId: 'forged' }, { type: 'social.post', body: 'hello' }, 'forged-post')).toThrow('Unknown entity');
  });
  it('replays identical keys but rejects actor or payload conflicts', () => {
    const engine = new WorldEngine(); const command: Command = { type: 'world.pause', paused: true }; const state = engine.dispatch(operator, command, 'pause-world');
    expect(engine.dispatch(operator, command, 'pause-world')).toEqual(state);
    expect(() => engine.dispatch(operator, { ...command, paused: false }, 'pause-world')).toThrow('already used');
    expect(() => engine.dispatch({ role: 'system' }, command, 'pause-world')).toThrow('already used');
  });
  it('preserves old revisions and supersedes tasks evidence and confirmations', () => {
    const { engine, id } = started(); tick(engine, 2); const before = engine.getState(); before.confirmations.push({ id: 'confirm-1', goalId: id, revision: 1, question: 'Continue?', status: 'pending' }); const resumed = new WorldEngine(before);
    const state = resumed.dispatch(operator, { type: 'goal.revise', goalId: id, expectedRevision: 1, objective: 'Revised useful knowledge resource', criteria: ['New verified requirement'], constraints: [] }, 'revise-goal');
    expect(state.goals[0]?.revisions).toHaveLength(2); expect(state.tasks.filter(task => task.revision === 1).every(task => task.status === 'superseded')).toBe(true); expect(state.evidence.every(run => run.status === 'stale')).toBe(true);
    expect(() => resumed.dispatch(operator, { type: 'confirmation.respond', confirmationId: 'confirm-1', expectedRevision: 1, answer: 'yes' }, 'respond-old')).toThrow('revision');
  });
  it('keeps one goal through paused and awaiting acceptance states', () => {
    const { engine, id } = started(); engine.dispatch(operator, { type: 'goal.control', goalId: id, expectedRevision: 1, action: 'pause', feedback: '' }, 'pause-goal');
    expect(create(engine)).toBe(id);
    expect(() => engine.dispatch(operator, { type: 'goal.create', objective: 'Another objective', criteria: ['New criterion'], constraints: [] }, 'another-goal')).toThrow('existing goal');
  });
  it('world pause prevents autonomous activity and publication', () => {
    const { engine } = started(); engine.dispatch(operator, { type: 'world.pause', paused: true }, 'pause-world'); tick(engine); expect(engine.getState().turn).toBe(0);
  });
  it('enforces moderator authority expiry, bounds and temporary restriction', () => {
    const engine = new WorldEngine(); const action: Command = { type: 'governance.moderate', targetId: 'builder-1', minutes: 1, reason: 'Repeated noisy messages' };
    expect(() => engine.dispatch({ role: 'entity', entityId: 'builder-1' }, action, 'bad-moderation')).toThrow('appointment');
    engine.dispatch({ role: 'entity', entityId: 'moderator' }, action, 'moderate-one');
    expect(() => engine.dispatch({ role: 'entity', entityId: 'builder-1' }, { type: 'social.post', body: 'hello' }, 'restricted-post')).toThrow('restricted');
    tick(engine, 1); expect(engine.dispatch({ role: 'entity', entityId: 'builder-1' }, { type: 'social.post', body: 'hello' }, 'allowed-post').discussions).toHaveLength(1);
    const state = engine.getState(); state.clock = '2026-10-20T00:00:00.000Z'; expect(() => new WorldEngine(state).dispatch({ role: 'entity', entityId: 'moderator' }, action, 'expired-moderator')).toThrow('appointment');
  });
  it('applies personality at next turn with public event provenance', () => {
    const engine = new WorldEngine(); const actor = { role: 'entity' as const, entityId: 'researcher' }; const state = engine.dispatch(actor, { type: 'social.post', body: 'Learning from public sources' }, 'public-source');
    const eventId = state.events[0]?.id ?? ''; engine.dispatch(actor, { type: 'entity.personality', trait: 'reflective', rationale: 'Learning from a public exchange', eventIds: [eventId] }, 'personality-change');
    expect(engine.getState().entities.find(entity => entity.id === 'researcher')?.personality).not.toContain('reflective'); tick(engine, 1); expect(engine.getState().entities.find(entity => entity.id === 'researcher')?.personality).toContain('reflective');
  });
  it('round trips state and rejects corrupt snapshots', () => { const state = started().engine.getState(); expect(parseWorldState(JSON.stringify(state))).toEqual(state); expect(() => parseWorldState('{"schemaVersion":1}')).toThrow(); });
});

it('reserves paid allowance atomically only after explicit live activation', () => {
  const simulation = new WorldEngine(); expect(() => simulation.reserveBudget('researcher', 0.1, 'reserve-one')).toThrow('live activation');
  const state = createInitialState(); state.mode = 'live'; state.budget.dailyUsd = 1;

  for (const entity of state.entities) entity.dailyAllowanceUsd = 1;
  const engine = new WorldEngine(state);
  engine.reserveBudget('researcher', 0.8, 'reserve-one'); expect(() => engine.reserveBudget('builder-1', 0.3, 'reserve-two')).toThrow('exhausted');
  expect(engine.getState().reservations).toHaveLength(1); engine.settleBudget('reserve-one', 0.6); engine.settleBudget('reserve-one', 0.6); expect(engine.getState().budget.spentUsd).toBe(0.6);
});

it('rejects stale publication after direction change and cancellation', () => {
  const { engine, id } = started(); engine.dispatch(operator, { type: 'goal.revise', goalId: id, expectedRevision: 1, objective: 'New changed direction', criteria: ['Changed criterion'], constraints: [] }, 'revise-publish');
  expect(() => engine.recordDeployment({ id: 'deployment-1', entityId: 'builder-1', commit: 'a'.repeat(40), bundleHash: 'a'.repeat(64), version: 1, environment: 'simulation', status: 'published', createdAt: engine.getState().clock, goalId: id, revision: 1 })).toThrow('revision');
  engine.dispatch(operator, { type: 'goal.control', goalId: id, expectedRevision: 2, action: 'cancel', feedback: '' }, 'cancel-publish');
  expect(() => engine.recordDeployment({ id: 'deployment-2', entityId: 'builder-1', commit: 'a'.repeat(40), bundleHash: 'a'.repeat(64), version: 1, environment: 'simulation', status: 'published', createdAt: engine.getState().clock, goalId: id, revision: 2 })).toThrow('publishable');
});

it('requires current evidence even if completion state was persisted incorrectly', () => {
  const { engine, id } = started(); const state = engine.getState();

 if (state.goals[0]) state.goals[0].status = 'awaiting_acceptance';
  expect(() => new WorldEngine(state).dispatch(operator, { type: 'goal.control', goalId: id, expectedRevision: 1, action: 'accept', feedback: '' }, 'accept-forged')).toThrow('evidence');
});

it('rejects literal private goal material in deliberate public publication', () => {
  const { engine } = started();
  expect(() => engine.dispatch({ role: 'entity', entityId: 'researcher' }, { type: 'social.post', body: 'Leaking PRIVATE build knowledge resource' }, 'private-publication')).toThrow('private goal');
  expect(engine.getPublicState().discussions).toHaveLength(0);
});

it('live tasks require assigned ownership dependencies and independent review', () => {
  const initial = createInitialState(); initial.mode = 'live'; const engine = new WorldEngine(initial); const id = create(engine);
  engine.dispatch(operator, { type: 'goal.start', goalId: id }, 'live-start');
  const tasks = engine.getState().tasks; const research = tasks.find(task => task.entityId === 'researcher'); const builder = tasks.find(task => task.entityId === 'builder-1');

  if (!research || !builder) throw new Error('Missing fixture tasks');
  expect(() => engine.dispatch({ role: 'entity', entityId: 'builder-1' }, { type: 'task.claim', taskId: research.id, expectedRevision: 1 }, 'wrong-owner')).toThrow('assigned');
  expect(() => engine.dispatch({ role: 'entity', entityId: 'builder-1' }, { type: 'task.claim', taskId: builder.id, expectedRevision: 1 }, 'unready-task')).toThrow('dependencies');
  engine.dispatch({ role: 'entity', entityId: 'researcher' }, { type: 'task.claim', taskId: research.id, expectedRevision: 1 }, 'claim-research');
  engine.dispatch({ role: 'entity', entityId: 'researcher' }, { type: 'task.submit', taskId: research.id, expectedRevision: 1, summary: 'Private research result ready for review' }, 'submit-research');
  expect(() => engine.dispatch({ role: 'entity', entityId: 'researcher' }, { type: 'task.review', taskId: research.id, expectedRevision: 1, approved: true, feedback: 'I declare my own research correct' }, 'self-review')).toThrow('Operator');
  engine.dispatch(operator, { type: 'task.review', taskId: research.id, expectedRevision: 1, approved: true, feedback: 'Independently inspected source provenance' }, 'review-research');
  expect(engine.dispatch({ role: 'entity', entityId: 'builder-1' }, { type: 'task.claim', taskId: builder.id, expectedRevision: 1 }, 'claim-builder').tasks.find(task => task.id === builder.id)?.status).toBe('running');
});

it('live criteria require an independently reviewed current live deployment', () => {
  const initial = createInitialState(); initial.mode = 'live'; const engine = new WorldEngine(initial); const id = create(engine); engine.dispatch(operator, { type: 'goal.start', goalId: id }, 'live-evidence-start');
  expect(() => engine.dispatch(operator, { type: 'goal.verify', goalId: id, expectedRevision: 1, criterionIndex: 0, deploymentId: 'missing', assertions: ['Inspected saved service output'] }, 'missing-live-evidence')).toThrow('deployment');
  engine.recordDeployment({ projectId: 'collective', id: 'live-deployment', entityId: 'builder-1', commit: 'a'.repeat(40), bundleHash: 'a'.repeat(64), version: 1, environment: 'production', status: 'published', createdAt: initial.clock, goalId: id, revision: 1 });
  const state = engine.dispatch(operator, { type: 'goal.verify', goalId: id, expectedRevision: 1, criterionIndex: 0, deploymentId: 'live-deployment', assertions: ['Inspected saved service output'] }, 'verify-live-evidence');
  expect(state.evidence[0]?.environment).toBe('production'); expect(state.goals[0]?.status).toBe('active');
});

it('enforces explicit per-entity caps separately from the global allowance', () => {
  const state = createInitialState(); state.mode = 'live'; const engine = new WorldEngine(state);
  engine.dispatch(operator, { type: 'budget.configure', dailyUsd: 10 }, 'global-allowance');
  expect(() => engine.reserveBudget('researcher', 0.1, 'ungranted-reserve')).toThrow('Entity allowance');
  engine.dispatch(operator, { type: 'budget.entity.configure', entityId: 'researcher', dailyUsd: 1 }, 'entity-allowance');
  engine.reserveBudget('researcher', 0.8, 'entity-reserved');
  expect(() => engine.reserveBudget('researcher', 0.3, 'entity-over-cap')).toThrow('Entity allowance');
  engine.settleBudget('entity-reserved', 0.5);
  engine.reserveBudget('researcher', 0.5, 'entity-remainder');
  expect(() => engine.dispatch(operator, { type: 'budget.entity.configure', entityId: 'researcher', dailyUsd: 0.9 }, 'lower-entity-cap')).toThrow('committed');
});

it('rolls daily settled usage while retaining outstanding entity reservations', () => {
  const state = createInitialState(); state.mode = 'live'; state.budget.dailyUsd = 2;

  for (const entity of state.entities) entity.dailyAllowanceUsd = 1;
  const engine = new WorldEngine(state); engine.reserveBudget('researcher', 0.8, 'day-one-reserve'); engine.settleBudget('day-one-reserve', 0.8);
  engine.reserveBudget('builder-1', 0.7, 'outstanding-reserve');
  const nextDay = engine.getState(); nextDay.clock = '2026-10-13T00:00:00.000Z'; const restored = new WorldEngine(nextDay);
  restored.reserveBudget('researcher', 0.8, 'day-two-reserve');
  expect(restored.getState().budget.spentUsd).toBe(0);
  expect(restored.getState().budget.outstandingReservedUsd).toBeCloseTo(1.5);
  restored.reserveBudget('builder-1', 0.4, 'today-builder-cap');
  expect(() => restored.reserveBudget('builder-1', 0.7, 'today-over-cap')).toThrow('Entity allowance');
  restored.settleBudget('outstanding-reserve', 0.4);
  expect(restored.getState().budget.spentUsd).toBe(0);
  expect(restored.getState().reservations.find(item => item.id === 'outstanding-reserve')).toMatchObject({ actualUsd: 0.4, status: 'settled', createdAt: state.clock });
});

it('migrates old entity profiles to zero allowance on snapshot parse', () => {
  const state = createInitialState();

 for (const entity of state.entities) delete entity.dailyAllowanceUsd;
  expect(parseWorldState(JSON.stringify(state)).entities.every(entity => entity.dailyAllowanceUsd === 0)).toBe(true);
});

it('allows operators to renew or replace fixed-term offices without changing identity', () => {
  const engine = new WorldEngine();
  expect(() => engine.dispatch({ role: 'entity', entityId: 'researcher' }, { type: 'governance.appoint', entityId: 'researcher', role: 'moderator' }, 'self-appointment')).toThrow('Operator');
  const state = engine.dispatch(operator, { type: 'governance.appoint', entityId: 'researcher', role: 'moderator' }, 'appoint-moderator');
  expect(state.appointments.filter(office => office.role === 'moderator' && office.expiresAt > state.clock).map(office => office.entityId)).toEqual(['researcher']);
  expect(state.entities.find(entity => entity.id === 'researcher')?.name).toBe('Sage');
});

it('requests private human confirmation blocks dispatch and resumes after an explicit answer', () => {
  const { engine, id } = started(); const actor = { role: 'entity' as const, entityId: 'researcher' }; const taskId = `${id}-r1-researcher`;
  engine.dispatch(actor, { type: 'task.claim', taskId, expectedRevision: 1 }, 'claim-confirmation');
  const state = engine.dispatch(actor, { type: 'confirmation.request', taskId, expectedRevision: 1, question: 'Should I use a compact public overview?' }, 'request-confirmation');
  const confirmation = state.confirmations[0];

 if (!confirmation) throw new Error('Missing confirmation');
  tick(engine, 5); expect(engine.getState().tasks.find(task => task.id === taskId)?.status).toBe('blocked');
  expect(JSON.stringify(engine.getPublicState())).not.toContain('compact public overview');
  engine.dispatch(operator, { type: 'confirmation.respond', confirmationId: confirmation.id, expectedRevision: 1, answer: 'Use a concise overview with clear references' }, 'answer-confirmation');
  expect(engine.getState().tasks.find(task => task.id === taskId)?.status).toBe('queued');
});

it('updates public profile without identity or authority changes and labels relationships as claims', () => {
  const engine = new WorldEngine(); const actor = { role: 'entity' as const, entityId: 'researcher' };
  engine.dispatch(actor, { type: 'entity.profile', name: 'Sage of Sources', description: 'A researcher of traceable public knowledge' }, 'profile-update');
  const posted = engine.dispatch(actor, { type: 'social.post', body: 'I enjoyed our public collaboration' }, 'relationship-source');
  const source = posted.events.at(-1);

 if (!source) throw new Error('Missing public source');
  const state = engine.dispatch(actor, { type: 'relationship.record', targetId: 'builder-1', label: 'Collaborator', eventIds: [source.id] }, 'relationship-record');
  expect(state.entities.find(entity => entity.id === 'researcher')?.role).toBe('researcher');
  expect(state.entities.find(entity => entity.id === 'researcher')?.name).toBe('Sage of Sources');
  expect(engine.getPublicState().relationships[0]?.kind).toBe('agent_claim');
  expect(() => engine.dispatch(actor, { type: 'relationship.record', targetId: 'builder-1', label: 'Secret relationship', eventIds: ['private-source'] }, 'relationship-invalid')).toThrow('public source');
});

it('blocks after three failed assigned attempts and allows explicit operator recovery', () => {
  const { engine, id } = started(); const actor = { role: 'entity' as const, entityId: 'researcher' }; const taskId = `${id}-r1-researcher`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    engine.dispatch(actor, { type: 'task.claim', taskId, expectedRevision: 1 }, `claim-attempt-${attempt}`);
    engine.dispatch(actor, { type: 'task.fail', taskId, expectedRevision: 1, reason: 'Scoped tool failed repeatedly' }, `fail-attempt-${attempt}`);
  }

  expect(engine.getState().goals[0]?.status).toBe('blocked');
  const state = engine.dispatch(operator, { type: 'goal.control', goalId: id, expectedRevision: 1, action: 'resume', feedback: '' }, 'recover-failed-task');
  expect(state.tasks.find(task => task.id === taskId)?.status).toBe('queued');
});

it('permits only operators to reconcile unknown costs and deduplicates reconciliation', () => {
  const state = createInitialState(); state.mode = 'live'; state.budget.dailyUsd = 1;

  for (const entity of state.entities) entity.dailyAllowanceUsd = 1;
  const engine = new WorldEngine(state); engine.reserveBudget('researcher', 0.5, 'unknown-cost');
  const command: Command = { type: 'budget.reconcile', reservationId: 'unknown-cost', actualUsd: 0.3 };
  expect(() => engine.dispatch({ role: 'entity', entityId: 'researcher' }, command, 'entity-reconcile')).toThrow('Operator');
  const settled = engine.dispatch(operator, command, 'operator-reconcile');
  expect(engine.dispatch(operator, command, 'operator-reconcile')).toEqual(settled);
  expect(settled.budget.reservedUsd).toBe(0); expect(settled.budget.spentUsd).toBe(0.3);
});

it('records measured cost above its estimate and prevents further over-budget dispatch', () => {
  const state = createInitialState(); state.mode = 'live'; state.budget.dailyUsd = 0.5;
  const entity = state.entities.find(item => item.id === 'researcher');

  if (!entity) throw new Error('Missing entity fixture');
  entity.dailyAllowanceUsd = 0.5;
  const engine = new WorldEngine(state);
  engine.reserveBudget('researcher', 0.2, 'underestimated-cost');
  engine.settleBudget('underestimated-cost', 0.7);
  expect(engine.getState().budget.spentUsd).toBe(0.7);
  expect(engine.getState().events.at(-1)?.type).toBe('budget.overrun');
  expect(() => engine.reserveBudget('researcher', 0.1, 'blocked-overrun')).toThrow('allowance');
});
