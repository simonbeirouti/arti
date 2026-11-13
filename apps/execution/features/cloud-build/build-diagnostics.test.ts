import { describe, expect, it } from 'vitest';
import { buildFailure, buildFailureMarkerKey, deterministicBuildFailure, parseBuildFailureMarker, privateBuildCapture } from './build-diagnostics';

const encode = (text: string) => new TextEncoder().encode(text);

describe('private build failure diagnostics', () => {
  it.each([['Compilation', 'compilation'], ['Tests', 'tests'], ['Smoke', 'smoke']])('classifies runner %s failures without retrying unchanged source', (phase, category) => {
    const failure = buildFailure(1, encode(''), encode(`file:///runner.mjs:24\nthrow new Error(...)\n\nError: ${phase} failed: assertion details\n at runner`));
    expect(failure.category).toBe(category);
    expect(deterministicBuildFailure(failure)).toBe(true);
    expect(failure.stderr).toContain('assertion details');
  });

  it('retains retries for unclassified process failure and bounds untrusted output', () => {
    const failure = buildFailure(137, encode('x'.repeat(100_000)), encode('process terminated\n' + 'y'.repeat(100_000)));
    expect(failure.category).toBe('execution');
    expect(deterministicBuildFailure(failure)).toBe(false);
    expect(failure.stdout.length).toBe(32_768);
    expect(failure.stderr.length).toBe(32_768);
  });

  it('pins private diagnostics to source and environment, with no successful assertions', () => {
    const capture = privateBuildCapture(buildFailure(1, encode('private stdout'), encode('Error: Tests failed: private stderr')), { sourceRevision: 'a'.repeat(40), repository: 'builder-1-personal-test', entityId: 'builder-1', workflowId: 'build-123' });
    expect(capture).toMatchObject({ sourceRevision: 'a'.repeat(40), environment: 'cloudflare-offline-build', status: 'failed', diagnosticsAreUntrusted: true, category: 'tests' });
    expect(capture).not.toHaveProperty('assertions');
  });
});

describe('scoped agent build feedback', () => {
  it('looks up only an owned repository exact head and returns fixed code/commit', () => {
    const commit = 'b'.repeat(40);
    expect(buildFailureMarkerKey('builder-1-personal-site', commit)).toBe(`private-build-status/builder-1-personal-site/${commit}.json`);
    expect(parseBuildFailureMarker(JSON.stringify({ code: 'tests', commit }), commit)).toEqual({ code: 'tests', commit });
    expect(() => parseBuildFailureMarker(JSON.stringify({ code: 'tests', commit, stderr: 'secret' }), commit)).toThrow();
    expect(() => parseBuildFailureMarker(JSON.stringify({ code: 'tests', commit }), 'a'.repeat(40))).toThrow();
    expect(() => buildFailureMarkerKey('../other', commit)).toThrow();
  });
});
