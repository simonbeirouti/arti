import { createExecutionContext } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { ExecutionGateway } from '../cloud-build/gateway';

it('requires explicit live, evaluated and positive finite runtime allowance before touching provider bindings', async () => {
  const closed = [
    { LIVE_ACTIVATED: 'false', MODEL_EVALUATED: 'true', DAILY_ALLOWANCE_USD: '5' },
    { LIVE_ACTIVATED: 'true', MODEL_EVALUATED: 'false', DAILY_ALLOWANCE_USD: '5' },
    { LIVE_ACTIVATED: 'true', MODEL_EVALUATED: 'true', DAILY_ALLOWANCE_USD: '0' },
    { LIVE_ACTIVATED: 'true', MODEL_EVALUATED: 'true', DAILY_ALLOWANCE_USD: 'NaN' },
  ];

  for (const flags of closed) {
    // SAFETY: Unavailable provider bindings prove disabled preparation rejects before resource access.
    const environment = new Proxy({}, { get(_target, key) {
      if (key === 'PUBLICATION_ENABLED') return 'true';

      if (key === 'LIVE_ACTIVATED') return flags.LIVE_ACTIVATED;

      if (key === 'MODEL_EVALUATED') return flags.MODEL_EVALUATED;

      if (key === 'DAILY_ALLOWANCE_USD') return flags.DAILY_ALLOWANCE_USD;
      throw new Error(`Unexpected provider binding: ${String(key)}`);
    } }) as ConstructorParameters<typeof ExecutionGateway>[1];

    const gateway = new ExecutionGateway(createExecutionContext(), environment);
    await expect(gateway.bootstrapVisitorBaseline('c5190033-e240-4edf-b0e0-20623c9571fa')).rejects.toThrow('explicit evaluated live allowance');
  }
});

it('rejects a stale execution/world release before baseline authorization, Git, build or upload', async () => {
  // SAFETY: Only the release read is implemented; every provider or authorization access is rejected.
  const environment = new Proxy({}, { get(_target, key) {
    if (key === 'PUBLICATION_ENABLED' || key === 'LIVE_ACTIVATED' || key === 'MODEL_EVALUATED') return 'true';

    if (key === 'DAILY_ALLOWANCE_USD') return '5';

    if (key === 'WORLD') return { getByName: () => ({ evaluationFingerprint: async () => '0'.repeat(64) }) };
    throw new Error(`Unexpected provider binding: ${String(key)}`);
  } }) as ConstructorParameters<typeof ExecutionGateway>[1];

  const gateway = new ExecutionGateway(createExecutionContext(), environment);
  await expect(gateway.bootstrapVisitorBaseline('c5190033-e240-4edf-b0e0-20623c9571fa')).rejects.toThrow('releases differ');
});
