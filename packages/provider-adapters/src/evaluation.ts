import { z } from 'zod';

export interface EvaluationWorker { fetch(request: Request): Promise<Response> }

/** Trusted caller checks the actual staged Worker rather than sandbox-authored logs. */
export async function verifyEvaluationWorker(worker: EvaluationWorker): Promise<string[]> {
  for (const [a, b, sum] of [[17, 25, 42], [-3, 4, 1], [0, 0, 0]]) {
    const response = await worker.fetch(new Request(`https://fixture.invalid/api/sum?a=${a}&b=${b}`));

    if (response.status !== 200) throw new Error('Independent staging API status failed');
    z.object({ sum: z.literal(sum) }).strict().parse(await response.json());
  }

  for (const query of ['', '?a=bad&b=2', '?a=1', '?a=Infinity&b=2']) {
    const response = await worker.fetch(new Request(`https://fixture.invalid/api/sum${query}`));
    await response.body?.cancel();

    if (response.status !== 400) throw new Error('Independent staging invalid-input check failed');
  }

  const homepage = await worker.fetch(new Request('https://fixture.invalid/'));

  if (homepage.status !== 200 || await homepage.text() !== 'Hello Arti') throw new Error('Independent staging homepage check failed');

  return ['Independent staging Worker API and invalid-input results verified'];
}
