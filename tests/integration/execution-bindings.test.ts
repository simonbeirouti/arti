/// <reference types="@cloudflare/workers-types" />
import { expectTypeOf, it } from 'vitest';
import type { ArtifactsBinding, AiBinding } from '../../packages/provider-adapters/src/cloudflare';
import type { BrowserCaptureBinding } from '../../apps/execution/features/browser-research/capture';
import type { DispatchBinding } from '../../apps/execution/features/publication/dispatch';

it('matches installed Cloudflare runtime binding interfaces', () => {
  expectTypeOf<BrowserRun>().toExtend<BrowserCaptureBinding>();
  expectTypeOf<Artifacts>().toExtend<ArtifactsBinding>();
  expectTypeOf<Ai>().toExtend<AiBinding>();
  expectTypeOf<DispatchNamespace>().toExtend<DispatchBinding>();
});
