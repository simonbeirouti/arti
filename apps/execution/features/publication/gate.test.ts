import { expect, it } from 'vitest';
import { publicationEnabled, requirePublication } from './gate';
import { dispatch } from './dispatch';
import { runScheduledJobs } from '../application-services/schedule';

it('preserves existing isolated-domain settings but fails closed for explicit false or invalid flags', () => {
  expect(publicationEnabled({})).toBe(true);
  expect(publicationEnabled({ PUBLICATION_ENABLED: 'true' })).toBe(true);

  for (const flag of ['false', '', 'TRUE', 'invalid']) expect(() => requirePublication({ PUBLICATION_ENABLED: flag })).toThrow('Entity publication disabled');
});

it('blocks serving generated code before consulting world, dispatch, or application storage', async () => {
  const response = await dispatch(new Request('https://builder.entities.invalid/'), {
    PUBLICATION_ENABLED: 'false', ENTITY_DOMAIN: 'entities.invalid',
    WORLD: { getByName() { throw new Error('World accessed'); } },
    DISPATCH: { get() { throw new Error('Generated code dispatched'); } },
  }, () => { throw new Error('Application storage accessed'); });

  expect(response.status).toBe(503);
});

it('blocks scheduled generated code before reads, reservations, writes, or job claims even when live', async () => {
  await runScheduledJobs({
    PUBLICATION_ENABLED: 'false', LIVE_ACTIVATED: 'true', DAILY_ALLOWANCE_USD: '5',
    WORLD: { getByName() { throw new Error('World accessed'); } },
    DISPATCH: { get() { throw new Error('Generated code dispatched'); } },
    BUILDS: { get() { throw new Error('Build read'); }, put() { throw new Error('Build write'); } },
  }, Date.now(), () => { throw new Error('Application storage accessed'); }, () => { throw new Error('Job claim attempted'); });
});
