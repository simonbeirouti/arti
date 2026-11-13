import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { WorldEngine } from '../../../../../packages/domain/src/index';
import { activateWorld, canRequestActivation, evaluateModel, listModelEvaluations, type Evaluation } from './model-readiness-api';
import { WorldPages } from './pages';

const run: Evaluation = {
  id: 'a795c30e-4949-46e1-bae3-b5d754eb16e1', model: '@cf/zai-org/glm-4.7-flash',
  fingerprint: 'a'.repeat(64), environment: 'staging', status: 'passed',
  allowanceUsd: 0.1, reservedUsd: 0.08,
  cases: [{ id: 'coding-build', passed: true, assertions: ['Saved behavior verified'] }],
};

afterEach(() => vi.unstubAllGlobals());

it('limits activation offers to a simulation with a passed evaluation', () => {
  expect(canRequestActivation('simulation', [])).toBe(false);
  expect(canRequestActivation('simulation', [{ ...run, status: 'failed' }])).toBe(false);
  expect(canRequestActivation('simulation', [run])).toBe(true);
  expect(canRequestActivation('live', [run])).toBe(false);
});

it('uses bounded authenticated same-origin requests without caller identity or deployment credentials', async () => {
  const requests: { path: string; options?: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => {
    requests.push({ path, options });

    return Response.json(options?.method === 'POST' ? run : { evaluations: [run] });
  });
  expect(await listModelEvaluations()).toEqual([run]);
  expect(await evaluateModel(run.id)).toEqual(run);
  await activateWorld();
  expect(requests.map(item => item.path)).toEqual(['/api/v1/evaluations', '/api/v1/evaluations', '/api/v1/activation']);
  expect(JSON.parse(String(requests[1].options?.body))).toEqual({ id: run.id, allowanceUsd: 0.1, acknowledge: 'RUN_PAID_MODEL_EVALUATION' });
  expect(JSON.parse(String(requests[2].options?.body))).toEqual({ acknowledgement: 'ENABLE_LIVE_WORLD', dailyAllowanceUsd: 5 });
  expect(requests[1].options?.headers).toEqual({ 'Content-Type': 'application/json' });
});

it('surfaces server rejection instead of treating a failed activation as successful', async () => {
  vi.stubGlobal('fetch', async () => new Response('Current-release evaluation required', { status: 403 }));
  await expect(activateWorld()).rejects.toThrow('Current-release evaluation required');
});

it('does not render model controls in public operations even if private state is accidentally supplied', () => {
  const engine = new WorldEngine();
  const state = engine.getState();
  const common = { data: state, state, publicWorld: engine.getPublicState(), catalogue: null, page: 'operations', dispatch: async () => true, busy: false, entityName: (id: string) => id };
  expect(renderToStaticMarkup(createElement(WorldPages, { ...common, isPublic: true }))).not.toContain('GLM model readiness');
  expect(renderToStaticMarkup(createElement(WorldPages, { ...common, isPublic: false }))).toContain('Run GLM evaluation ($0.10 cap)');
});

it('explains unavailable model checks in local simulation without inventing receipts', async () => {
  vi.stubGlobal('fetch', async () => new Response('<html>Not found</html>', { status: 404 }));
  await expect(listModelEvaluations()).rejects.toThrow('Local simulation does not run paid evaluations');
});
