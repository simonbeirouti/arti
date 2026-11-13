import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorldEngine } from '../../../../../packages/domain/src/index';
import { observedTraffic } from './traffic-view-model';
import { WorldScene } from './scene';

function fixture() {
  const state = new WorldEngine().getState();
  state.discussions = [];

  for (const entity of state.entities) entity.presence = { locationId: entity.id, activity: 'idle', peers: [], summary: 'Idle', updatedAt: state.clock };

  return state;
}

describe('observed circuit traffic', () => {
  it('does not invent activity on idle links', () => {
    expect(observedTraffic(fixture(), true)).toEqual([]);
  });

  it('draws active work only from persisted presence', () => {
    const state = fixture();
    state.entities[0].status = 'working';
    state.entities[0].presence = { locationId: 'steward', activity: 'working', peers: [], summary: 'Recorded work', updatedAt: state.clock };
    expect(observedTraffic(state, true)).toEqual([{ id: 'work-steward', from: 'steward', to: 'collective', status: 'active', kind: 'work', observedAt: state.clock }]);
  });

  it('does not animate completed social or publishing presence on an idle entity', () => {
    const state = fixture();
    state.entities[0].status = 'idle';
    state.entities[0].presence = { locationId: 'square', activity: 'discussing', peers: ['builder-1'], summary: 'Received a reply', updatedAt: state.clock };
    state.entities[1].presence = { locationId: 'moderator', activity: 'publishing', peers: [], summary: 'Published a checked release', updatedAt: state.clock };
    expect(observedTraffic(state, true)).toEqual([]);
  });

  it('renders completed public replies while excluding private messages and scripted live history', () => {
    const state = fixture();
    state.mode = 'live';
    const base = { entityId: 'builder-1', createdAt: state.clock, body: 'Public proposal', origin: 'agent' as const, visibility: 'public' as const };
    state.discussions = [{ ...base, id: 'public' }, { ...base, id: 'reply', replyTo: 'public', entityId: 'builder-2' }, { ...base, id: 'private', visibility: 'private' }, { ...base, id: 'unsafe-reply', replyTo: 'private', entityId: 'builder-2' }, { ...base, id: 'script', origin: 'simulation', replyTo: 'public', entityId: 'builder-2' }];
    expect(observedTraffic(state, true)).toEqual([{ id: 'reply-reply', from: 'builder-1', to: 'builder-2', status: 'completed', kind: 'reply', observedAt: state.clock }]);
  });

  it('keeps private dependency handoffs entirely outside public traffic and rendered markup', () => {
    const engine = new WorldEngine();
    const state = engine.dispatch({ role: 'operator' }, { type: 'goal.create', objective: 'SECRET private objective', criteria: ['Private verification'], constraints: [] }, 'traffic-private');
    const goal = state.goals[0];
    state.discussions = [];
    state.tasks = [
      { id: 'SECRET-prerequisite', goalId: goal.id, revision: goal.revision, entityId: 'builder-1', title: 'SECRET foundation', status: 'verified', dependencies: [], attempts: 0, evidenceIds: [] },
      { id: 'SECRET-dependent', goalId: goal.id, revision: goal.revision, entityId: 'builder-2', title: 'SECRET dependent', status: 'queued', dependencies: ['SECRET-prerequisite'], attempts: 0, evidenceIds: [] },
    ];
    expect(observedTraffic(state, true).filter(edge => edge.kind === 'handoff')).toEqual([]);
    expect(observedTraffic(state, false).filter(edge => edge.kind === 'handoff')).toMatchObject([{ from: 'builder-1', to: 'builder-2', status: 'queued' }]);
    expect(JSON.stringify(observedTraffic(state, false))).not.toContain('SECRET');
    const html = renderToStaticMarkup(createElement(WorldScene, { data: state, state, isPublic: true, onObserve: () => {} }));
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain(goal.id);
    expect(html).toContain('Private task traffic excluded');
  });

  it('marks paused scenes so outstanding activity is frozen rather than fabricated completion', () => {
    const state = fixture();
    state.paused = true;
    state.entities[0].status = 'working';
    state.entities[0].presence!.activity = 'working';
    const html = renderToStaticMarkup(createElement(WorldScene, { data: state, state: null, isPublic: true, onObserve: () => {} }));
    expect(html).toContain('world-paused');
    expect(html).toContain('traffic-active');
    expect(html).toContain('Dispatch paused');
    expect(html).not.toContain('traffic-completed');
  });
});
