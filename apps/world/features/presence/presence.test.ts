import { expect, it } from 'vitest';
import { WorldEngine, parseWorldState } from '../../../../packages/domain/src/index';

it('generates deterministic visits, one social exchange at a time, and stable homes from world ticks', () => {
  const first = new WorldEngine(); const replay = new WorldEngine();

  for (let tick = 1; tick <= 9; tick += 1) {
    const before = first.getState().discussions.length;
    first.dispatch({ role: 'system' }, { type: 'world.tick' }, `presence-tick-${tick}`);
    replay.dispatch({ role: 'system' }, { type: 'world.tick' }, `presence-tick-${tick}`);
    expect(first.getState()).toEqual(replay.getState());
    expect(first.getState().discussions.length - before).toBeLessThanOrEqual(2);
    const places = new Set(['square', ...first.getState().entities.map(entity => entity.id)]);
    expect(first.getState().entities.every(entity => entity.presence && places.has(entity.presence.locationId))).toBe(true);
  }

  expect(first.getState().discussions).toHaveLength(6);
  expect(new Set(first.getState().discussions.map(item => item.body)).size).toBeGreaterThan(2);
  expect(first.getState().discussions.filter(item => item.replyTo).every(reply => first.getState().discussions.some(ask => ask.id === reply.replyTo && ask.entityId !== reply.entityId))).toBe(true);
  expect(first.getState().relationships.every(item => item.kind === 'agent_claim' && item.eventIds.every(id => first.getState().events.some(event => event.id === id && event.visibility === 'public')))).toBe(true);
  expect(first.getState().events.some(event => event.type === 'entity.visited')).toBe(true);
  expect(first.getState().entities.some(entity => entity.presence?.activity === 'discussing')).toBe(true);
  const before = first.getState();
  first.dispatch({ role: 'system' }, { type: 'world.tick' }, 'presence-tick-9');
  expect(first.getState()).toEqual(before);
});

it('prioritizes assigned work and never exposes private work details in presence', () => {
  const engine = new WorldEngine();
  const drafted = engine.dispatch({ role: 'operator' }, { type: 'goal.create', objective: 'PRIVATE_CUSTOMER_PROJECT', criteria: ['PRIVATE_ACCEPTANCE_CRITERION'], constraints: ['PRIVATE_INTERNAL_CONSTRAINT'] }, 'presence-goal');
  const goal = drafted.goals[0];
  engine.dispatch({ role: 'operator' }, { type: 'goal.start', goalId: goal.id }, 'presence-start');
  engine.dispatch({ role: 'system' }, { type: 'world.tick' }, 'presence-work-tick');
  expect(engine.getState().entities.find(entity => entity.id === 'researcher')?.presence?.activity).toBe('researching');
  const projection = JSON.stringify(engine.getPublicState());
  expect(projection).not.toMatch(/PRIVATE_CUSTOMER|PRIVATE_ACCEPTANCE|PRIVATE_INTERNAL/);
  expect(projection).not.toContain(`${goal.id}-r1-researcher`);
  expect(engine.getState().events.some(event => event.type === 'entity.visited')).toBe(false);
});

it('freezes movement during world pause and suppresses personal movement during a paused goal', () => {
  const engine = new WorldEngine();
  engine.dispatch({ role: 'system' }, { type: 'world.tick' }, 'presence-first');
  engine.dispatch({ role: 'operator' }, { type: 'world.pause', paused: true }, 'presence-pause');
  const before = engine.getState().entities;
  engine.dispatch({ role: 'system' }, { type: 'world.tick' }, 'presence-paused-tick');
  expect(engine.getState().entities).toEqual(before);
  expect(engine.getPublicState().paused).toBe(true);
  engine.dispatch({ role: 'operator' }, { type: 'world.pause', paused: false }, 'presence-resume');
  const drafted = engine.dispatch({ role: 'operator' }, { type: 'goal.create', objective: 'Useful knowledge resource', criteria: ['Saved result verified'], constraints: [] }, 'presence-shared-goal');
  const goal = drafted.goals[0];
  engine.dispatch({ role: 'operator' }, { type: 'goal.start', goalId: goal.id }, 'presence-shared-start');
  engine.dispatch({ role: 'operator' }, { type: 'goal.control', goalId: goal.id, expectedRevision: 1, action: 'pause', feedback: '' }, 'presence-goal-pause');
  const frozen = engine.getState().entities;
  engine.dispatch({ role: 'system' }, { type: 'world.tick' }, 'presence-goal-paused-tick');
  expect(engine.getState().entities).toEqual(frozen);
});

it('derives live discussion presence from actual posts without inventing live visits', () => {
  const state = new WorldEngine().getState(); state.mode = 'live';
  const engine = new WorldEngine(state);
  const posted = engine.dispatch({ role: 'entity', entityId: 'researcher' }, { type: 'social.post', body: 'Here are some public source notes.' }, 'presence-live-post');
  engine.dispatch({ role: 'entity', entityId: 'archivist' }, { type: 'social.post', body: 'I can organize those public notes.', replyTo: posted.discussions[0].id }, 'presence-live-reply');
  expect(engine.getState().entities.find(entity => entity.id === 'archivist')?.presence).toMatchObject({ locationId: 'square', activity: 'discussing', peers: ['researcher'] });
  expect(engine.getState().entities.find(entity => entity.id === 'researcher')?.presence?.peers).toEqual(['archivist']);
  expect(engine.getState().events.some(event => event.type === 'entity.visited')).toBe(false);
});

it('migrates saved worlds without presence while preserving recorded presence on restart', () => {
  const state = new WorldEngine().getState();

  for (const entity of state.entities) delete entity.presence;
  const engine = new WorldEngine(parseWorldState(JSON.stringify(state)));
  expect(engine.getPublicState().entities.every(entity => entity.presence?.locationId === entity.id)).toBe(true);
  engine.dispatch({ role: 'system' }, { type: 'world.tick' }, 'presence-migration-tick');
  expect(new WorldEngine(parseWorldState(JSON.stringify(engine.getState()))).getState()).toEqual(engine.getState());
});

it('composes simulated exchanges from changed public profiles and evolves only with public provenance', () => {
  const engine = new WorldEngine();
  engine.dispatch({ role: 'entity', entityId: 'researcher' }, { type: 'entity.profile', name: 'Willow', description: 'Organizes public sources and citations' }, 'presence-rename');

  for (let tick = 1; tick <= 10; tick += 1) engine.dispatch({ role: 'system' }, { type: 'world.tick' }, `presence-profile-${tick}`);
  expect(engine.getState().discussions.some(item => item.body.includes('Willow'))).toBe(true);
  expect(engine.getState().personalityHistory.some(item => item.trait === 'collaborative')).toBe(true);
  expect(engine.getState().personalityHistory.every(item => item.eventIds.every(id => engine.getState().events.some(event => event.id === id && event.visibility === 'public')))).toBe(true);
  expect(engine.getState().entities.some(entity => entity.personality.includes('collaborative'))).toBe(true);
});
