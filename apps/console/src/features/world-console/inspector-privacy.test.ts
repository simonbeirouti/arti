import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { WorldEngine } from '../../../../../packages/domain/src/index';
import { InhabitantInspector } from './inhabitant-inspector';
import { districts } from './map-layout';

it('withholds private assignments in public mode even if private state was accidentally supplied', () => {
  const engine = new WorldEngine();
  const draft = engine.dispatch({ role: 'operator' }, { type: 'goal.create', objective: 'PRIVATE inspector objective', criteria: ['Useful output'], constraints: [] }, 'inspector-draft');
  const state = engine.dispatch({ role: 'operator' }, { type: 'goal.start', goalId: draft.goals[0].id }, 'inspector-start');
  state.tasks[0].title = 'SECRET assigned implementation';
  const entity = state.entities.find(item => item.id === state.tasks[0].entityId)!;
  const common = { entity, state, data: engine.getPublicState(), district: districts[0], onClose: () => {}, onObserve: () => {} };
  const publicHtml = renderToStaticMarkup(createElement(InhabitantInspector, { ...common, isPublic: true }));
  const privateHtml = renderToStaticMarkup(createElement(InhabitantInspector, { ...common, data: state, isPublic: false }));
  expect(publicHtml).not.toContain('SECRET');
  expect(publicHtml).not.toContain('PRIVATE');
  expect(privateHtml).toContain('SECRET assigned implementation');
});
