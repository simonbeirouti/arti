import { expect, it } from 'vitest';
import { releaseFingerprint } from '../../../world/generated/release';
import { assertRuntimeRelease } from './runtime-release';

it('accepts the compiled release and rejects drift before any turn work', () => {
  expect(() => assertRuntimeRelease(releaseFingerprint)).not.toThrow();
  let dispatched = 0;

  for (const authority of ['stale', '', 'f'.repeat(64)]) {
    expect(() => { assertRuntimeRelease(authority); dispatched += 1; }).toThrow('Agent runtime and world releases differ');
  }

  expect(dispatched).toBe(0);
});
