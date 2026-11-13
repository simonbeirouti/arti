import { releaseFingerprint } from '../../../world/generated/release';

/** A receiver compiled from another release cannot dispatch a model or tool turn. */
export function assertRuntimeRelease(authorityFingerprint: string): void {
  if (authorityFingerprint !== releaseFingerprint) throw new Error('Agent runtime and world releases differ');
}
