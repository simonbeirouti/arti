import { describe, expect, it } from 'vitest';
import { createInitialState, WorldEngine } from '../../../../packages/domain/src/index';
import { privateAssignment } from '../../../world/features/world-state/assignment';
import { turnInstructions } from './instructions';

describe('productive live turn instructions', () => {
  it('keeps idle residents in shared project planning without creating personal code work', () => {
    for (const entity of createInitialState().entities) {
      const instructions = turnInstructions(entity, null, false, 'permitted schema');
      expect(instructions).toContain('no assigned collective task');
      expect(instructions).toContain('Do not create a personal website or modify any repository');
      expect(instructions).toContain('approved shared project assignment');
      expect(instructions).not.toContain(`personal-${entity.id}-public-site`);
    }
  });

  it('prioritizes the exact current assignment and keeps scoped predecessor reports private', () => {
    const engine = new WorldEngine(createInitialState());
    engine.dispatch({ role: 'operator' }, { type: 'goal.create', objective: 'PRIVATE-GOAL-CANARY', criteria: ['A useful checked resource'], constraints: [] }, 'create-goal');
    const goal = engine.getState().goals[0]!;
    engine.dispatch({ role: 'operator' }, { type: 'goal.start', goalId: goal.id }, 'start-goal');
    const assignment = privateAssignment(engine.getState(), 'researcher');

    if (!assignment) throw new Error('Missing researcher assignment');
    const entity = engine.getState().entities.find(item => item.id === 'researcher')!;
    const instructions = turnInstructions(entity, assignment, true, 'permitted schema');
    expect(instructions).toContain(`Use taskId ${assignment.task.id} and expectedRevision 1`);
    expect(instructions).toContain('PRIVATE-GOAL-CANARY');
    expect(instructions).toContain('Use dependencyHandoffs');
    expect(instructions).toContain('submission bodies are private claims');
    expect(instructions).toContain('Do not copy these records into public outputs');
    expect(instructions).toContain('task.submit, not social.post');
    expect(instructions).toContain('do not task.submit while publication is queued');
    expect(instructions).not.toContain('Your bounded personal-development objective');
    expect(turnInstructions(entity, null, false, '')).not.toContain('PRIVATE-GOAL-CANARY');
  });

  it('waits when shared work is unfinished but no dependency-ready assignment exists', () => {
    const entity = createInitialState().entities[1]!;
    const instructions = turnInstructions(entity, null, true, 'permitted schema');
    expect(instructions).toContain('wait for a verified dependency or explicit direction');
    expect(instructions).not.toContain('Your bounded personal-development objective');
    expect(instructions).not.toContain('personal-moderator-public-site');
  });

  it('distinguishes asynchronous build requests from observed publication in both modes', () => {
    const state = createInitialState();
    const entity = state.entities[2]!;
    const instructions = turnInstructions(entity, null, false, 'permitted schema');
    expect(instructions).toContain('status queued only confirms a requested build');
    expect(instructions).toContain('inspect world deployment receipts before claiming publication');
    expect(instructions).toContain('Never describe queued work as tested, verified, deployed or published');
    expect(instructions).toContain('Never disclose private memory, goal text, confirmation answers, predecessor reports or operational evidence');
    expect(instructions).toContain('Human independent review and final acceptance remain required');
  });
});
