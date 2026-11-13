import { expect, it } from 'vitest';
import { verifyEvaluationWorker } from './evaluation';

it('verifies independently fetched staged results and rejects forged sandbox success', async () => {
  await expect(verifyEvaluationWorker({ fetch: async () => Response.json({ sum: 999 }) })).rejects.toThrow();
  const calls: string[] = [];

  const assertions = await verifyEvaluationWorker({ async fetch(request) {
    const url = new URL(request.url);
    calls.push(url.pathname + url.search);

    if (url.pathname !== '/api/sum') return new Response('Hello Arti');
    const a = url.searchParams.get('a');
    const b = url.searchParams.get('b');

    if (a === null || b === null || !Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return new Response('Invalid', { status: 400 });

    return Response.json({ sum: Number(a) + Number(b) });
  } });

  expect(calls).toHaveLength(8);
  expect(assertions).toEqual(['Independent staging Worker API and invalid-input results verified']);
});
