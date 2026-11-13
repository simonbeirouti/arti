import { describe, expect, it } from 'vitest';
import { WorldEngine, parseWorldState } from '../../../../packages/domain/src/index';
import type { Command } from '../../../../packages/contracts/src/index';
import { publicAssignment, authorizePublicAssignment } from './assignment';

const operator = { role: 'operator' } as const;

const text = 'Build an accessible public reference about browser storage with attributed public sources.';

function fixture() {
  const engine = new WorldEngine();
  engine.dispatch(operator, { type: 'goal.create', objective: 'PRIVATE OBJECTIVE CANARY', criteria: ['PRIVATE CRITERION CANARY'], constraints: ['PRIVATE CONSTRAINT CANARY'] }, 'authoring-create');
  const goal = engine.getState().goals[0];
  const approve: Command = { type: 'goal.public_brief', goalId: goal.id, expectedRevision: 1, text, acknowledgement: 'APPROVE_PUBLIC_AUTHORING' };

  return { engine, goal, approve };
}

describe('human-approved public authoring handoffs', () => {
  it('requires operator approval, rejects copying private inputs and preserves immutable revision history', () => {
    const { engine, goal, approve } = fixture();
    expect(() => engine.dispatch({ role: 'entity', entityId: 'researcher' }, approve, 'authoring-forged')).toThrow('Operator');
    expect(() => engine.dispatch({ role: 'system' }, approve, 'authoring-system')).toThrow('Operator');
    expect(() => engine.dispatch(operator, { ...approve, text: 'Publish PRIVATE OBJECTIVE CANARY' }, 'authoring-secret')).toThrow('private goal');
    engine.dispatch(operator, approve, 'authoring-approve');
    expect(() => engine.dispatch(operator, { ...approve, text: 'A replacement public objective' }, 'authoring-replace')).toThrow('Revise the goal');
    const state = parseWorldState(JSON.stringify(engine.getState()));
    expect(state.goals[0].revisions[0].publicBrief?.text).toBe(text);
    expect(state.goals[0].status).toBe('draft');
    expect(state.budget.dailyUsd).toBe(0);
    expect(JSON.stringify(engine.getPublicState())).not.toContain(text);
    expect(goal.revision).toBe(1);
  });

  it('gives a public writer only approved text and platform metadata, never private task records', () => {
    const { engine, goal, approve } = fixture();
    engine.dispatch(operator, approve, 'authoring-approve');
    engine.dispatch(operator, { type: 'goal.start', goalId: goal.id }, 'authoring-start');
    const state = engine.getState();
    state.tasks[0].title = 'PRIVATE TASK TITLE CANARY';
    state.discussions.push({ id: 'private-report', entityId: 'researcher', body: 'PRIVATE REPORT CANARY', createdAt: state.clock, visibility: 'private', goalId: goal.id });
    state.confirmations.push({ id: 'private-answer', entityId: 'researcher', taskId: state.tasks[0].id, goalId: goal.id, revision: 1, question: 'PRIVATE QUESTION CANARY', answer: 'PRIVATE ANSWER CANARY', status: 'answered' });
    const assignment = publicAssignment(state, 'researcher');
    expect(assignment?.brief).toBe(text);
    expect(JSON.stringify(assignment)).not.toContain('PRIVATE');
    expect(publicAssignment(state, 'builder-1')).toBeNull();
    expect(publicAssignment(state, 'unknown')).toBeNull();
    expect(() => authorizePublicAssignment(state, 'builder-1', assignment!.scope)).toThrow('no longer authorized');
  });

  it('invalidates authoring on revision, pause, cancellation and changed approval identity', () => {
    const { engine, goal, approve } = fixture();
    engine.dispatch(operator, approve, 'authoring-approve');
    engine.dispatch(operator, { type: 'goal.start', goalId: goal.id }, 'authoring-start');
    const assignment = publicAssignment(engine.getState(), 'researcher')!;
    expect(() => authorizePublicAssignment(engine.getState(), 'researcher', assignment.scope)).not.toThrow();
    expect(() => authorizePublicAssignment({ ...engine.getState(), paused: true }, 'researcher', assignment.scope)).toThrow();
    expect(() => authorizePublicAssignment(engine.getState(), 'researcher', { ...assignment.scope, approvalId: 'forged' })).toThrow();
    engine.dispatch(operator, { type: 'goal.revise', goalId: goal.id, expectedRevision: 1, objective: 'A changed private goal', criteria: ['New private criterion'], constraints: [] }, 'authoring-revise');
    expect(publicAssignment(engine.getState(), 'researcher')).toBeNull();
    expect(() => authorizePublicAssignment(engine.getState(), 'researcher', assignment.scope)).toThrow();
    expect(engine.getState().goals[0].revisions[0].publicBrief?.text).toBe(text);
    engine.dispatch(operator, { type: 'goal.control', goalId: goal.id, expectedRevision: 2, action: 'cancel', feedback: '' }, 'authoring-cancel');
    expect(publicAssignment(engine.getState(), 'researcher')).toBeNull();
  });
});
