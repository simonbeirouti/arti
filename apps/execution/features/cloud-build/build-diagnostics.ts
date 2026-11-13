import { z } from 'zod';

/** These captures stay in the private builds bucket; generated stderr is untrusted. */
export type BuildFailureCategory = 'compilation' | 'tests' | 'smoke' | 'execution';

export interface BuildFailure {
  category: BuildFailureCategory;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function buildFailure(exitCode: number, stdout: Uint8Array, stderr: Uint8Array): BuildFailure {
  const decoder = new TextDecoder();
  const error = decoder.decode(stderr);
  const phase = /^Error: (Compilation|Tests|Smoke) failed:/m.exec(error)?.[1];
  const category: BuildFailureCategory = phase === 'Compilation' ? 'compilation' : phase === 'Tests' ? 'tests' : phase === 'Smoke' ? 'smoke' : 'execution';

  return { category, exitCode, stdout: decoder.decode(stdout).slice(0, 32_768), stderr: error.slice(0, 32_768) };
}

export function deterministicBuildFailure(failure: BuildFailure): boolean {
  return failure.category !== 'execution';
}

export function privateBuildCapture(failure: BuildFailure, context: { sourceRevision: string; repository: string; entityId: string; workflowId: string }) {
  return { ...context, environment: 'cloudflare-offline-build', capturedAt: new Date().toISOString(), status: 'failed', diagnosticsAreUntrusted: true, ...failure };
}

const failureMarkerSchema = z.object({ code: z.enum(['compilation', 'tests', 'smoke', 'execution']), commit: z.string().regex(/^[a-f0-9]{40}$/) }).strict();

export function buildFailureMarkerKey(repository: string, commit: string): string {
  z.string().regex(/^[a-z0-9][a-z0-9_-]{0,199}$/).parse(repository);
  z.string().regex(/^[a-f0-9]{40}$/).parse(commit);

  return `private-build-status/${repository}/${commit}.json`;
}

export function parseBuildFailureMarker(text: string, commit: string) {
  const parsed = failureMarkerSchema.safeParse(JSON.parse(text));

  if (!parsed.success || parsed.data.commit !== commit) throw new Error('Invalid private build status marker');

  return parsed.data;
}
