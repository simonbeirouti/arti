import { describe, expect, it } from 'vitest';
import { stagingOperatorRequest, stagingAgentCaps, stagingWorldCap, turnDiagnostics, probeError } from '../../tooling/staging/operator-policy';

describe('account-authenticated staging setup policy', () => {
  it('rejects arbitrary commands, actor identities and allowance escalation', () => {
    for (const extra of [{ actorId: 'operator' }, { dailyUsd: 100 }, { command: { type: 'world.pause', paused: false } }]) expect(stagingOperatorRequest.safeParse({ operation: 'configure', acknowledgement: 'CONFIGURE_STAGING_WORLD', ...extra }).success).toBe(false);
    expect(stagingOperatorRequest.safeParse({ operation: 'shell', acknowledgement: 'CONFIGURE_STAGING_WORLD' }).success).toBe(false);
  });
  it('requires operation-specific acknowledgement', () => {
    expect(stagingOperatorRequest.safeParse({ operation: 'activate', acknowledgement: 'RUN_PAID_MODEL_EVALUATION' }).success).toBe(false);
    expect(stagingOperatorRequest.parse({ operation: 'activate', acknowledgement: 'ENABLE_LIVE_WORLD' }).operation).toBe('activate');
  });
  it('permits only the fixed acknowledged live wake without caller-selected targets', () => {
    expect(stagingOperatorRequest.parse({ operation: 'wake', acknowledgement: 'WAKE_LIVE_AGENTS' }).operation).toBe('wake');
    expect(stagingOperatorRequest.safeParse({ operation: 'wake', acknowledgement: 'ENABLE_LIVE_WORLD' }).success).toBe(false);
    expect(stagingOperatorRequest.safeParse({ operation: 'wake', acknowledgement: 'WAKE_LIVE_AGENTS', entityId: 'steward' }).success).toBe(false);
    expect(stagingOperatorRequest.safeParse({ operation: 'wake', acknowledgement: 'WAKE_LIVE_AGENTS', count: 100 }).success).toBe(false);
  });
  it('permits only the acknowledged backup without caller-controlled scope or restore', () => {
    expect(stagingOperatorRequest.parse({ operation: 'backup', acknowledgement: 'BACK_UP_LIVE_WORLD' }).operation).toBe('backup');
    expect(stagingOperatorRequest.safeParse({ operation: 'backup', acknowledgement: 'ENABLE_LIVE_WORLD' }).success).toBe(false);

    for (const extra of [{ key: 'world/private.json' }, { scheduledTime: 0 }, { backupId: 'chosen' }, { allowanceUsd: 5 }, { actorId: 'operator' }]) {
      expect(stagingOperatorRequest.safeParse({ operation: 'backup', acknowledgement: 'BACK_UP_LIVE_WORLD', ...extra }).success).toBe(false);
    }

    expect(stagingOperatorRequest.safeParse({ operation: 'restore', acknowledgement: 'BACK_UP_LIVE_WORLD' }).success).toBe(false);
  });
  it.each([
    { operation: 'pause', acknowledgement: 'PAUSE_LIVE_WORLD', incorrect: 'RESUME_LIVE_WORLD' },
    { operation: 'resume', acknowledgement: 'RESUME_LIVE_WORLD', incorrect: 'PAUSE_LIVE_WORLD' },
  ])('permits only fixed acknowledged $operation without caller-selected commands', (request) => {
    const { operation, acknowledgement, incorrect } = request;

    expect(stagingOperatorRequest.parse({ operation, acknowledgement }).operation).toBe(operation);
    expect(stagingOperatorRequest.safeParse({ operation, acknowledgement: incorrect }).success).toBe(false);

    for (const extra of [{ paused: false }, { actorId: 'operator' }, { idempotencyKey: 'chosen' }, { command: { type: 'world.pause', paused: false } }]) {
      expect(stagingOperatorRequest.safeParse({ operation, acknowledgement, ...extra }).success).toBe(false);
    }
  });
  it('preserves six approved caps and adds zero allowances for the two new builders', () => {
    expect(stagingAgentCaps).toEqual({ steward: 0.75, moderator: 0.75, 'builder-1': 1.25, 'builder-2': 1, 'builder-3': 0, 'builder-4': 0, researcher: 1, archivist: 0.25 });
    expect(Object.values(stagingAgentCaps).reduce<number>((a, b) => a + b, 0)).toBe(stagingWorldCap);
  });
});

it('exposes only acknowledged fixed-population diagnostics and strips private entry content', () => {
  expect(stagingOperatorRequest.parse({ operation: 'diagnostics', acknowledgement: 'INSPECT_LIVE_TURN_DIAGNOSTICS' }).operation).toBe('diagnostics');
  expect(stagingOperatorRequest.safeParse({ operation: 'diagnostics', acknowledgement: 'INSPECT_STAGING_WORLD' }).success).toBe(false);
  expect(stagingOperatorRequest.safeParse({ operation: 'diagnostics', acknowledgement: 'INSPECT_LIVE_TURN_DIAGNOSTICS', entityId: 'researcher' }).success).toBe(false);
  const privateText = 'PRIVATE goal, credential, reflection and arguments';
  const entry = JSON.stringify({ tool: 'repo.patch_commit', arguments: privateText, observation: privateText });
  const diagnostics = turnDiagnostics([privateText, entry, entry, JSON.stringify({ tool: privateText, arguments: privateText, observation: privateText }), 'Tool failed; inspect permissions and revise the action', 'unrelated failed private text']);

  expect(diagnostics).toEqual({ entryCount: 6, successfulTools: [{ tool: 'repo.patch_commit', count: 2 }], failures: 1, failureCodes: [], runtimeFailures: [], latestTools: ['repo.patch_commit', 'repo.patch_commit'] });
  expect(JSON.stringify(diagnostics)).not.toContain(privateText);
  expect(turnDiagnostics(Array.from({ length: 20 }, () => entry)).latestTools).toHaveLength(12);
});

it('limits repository transport probing to the acknowledged fixed public-source edit', () => {
  const request = { operation: 'probe', acknowledgement: 'VERIFY_STAGING_REPOSITORY_TOOLS' };

  expect(stagingOperatorRequest.parse(request).operation).toBe('probe');
  expect(stagingOperatorRequest.safeParse({ ...request, acknowledgement: 'WAKE_LIVE_AGENTS' }).success).toBe(false);

  for (const extra of [{ entityId: 'steward' }, { taskId: 'other' }, { path: 'agent/instructions.md' }, { content: 'chosen' }, { tool: 'execution.request_build' }, { commit: 'a'.repeat(40) }]) {
    expect(stagingOperatorRequest.safeParse({ ...request, ...extra }).success).toBe(false);
  }

  expect(probeError('Patch failed')).toBe('Patch failed');
  expect(probeError('Trusted Git transport failed')).toBe('Trusted Git transport failed');
  expect(probeError('Token secret at https://private.example')).toBe('Repository probe failed');
  expect(probeError('Patch failed with token secret')).toBe('Repository probe failed');
});

it('permits only the acknowledged two-agent release check without targets, count or interval controls', () => {
  const request = { operation: 'verify-turn', acknowledgement: 'RUN_BOUNDED_LIVE_RUNTIME_CHECK' };

  expect(stagingOperatorRequest.parse(request).operation).toBe('verify-turn');
  expect(stagingOperatorRequest.safeParse({ ...request, acknowledgement: 'WAKE_LIVE_AGENTS' }).success).toBe(false);

  for (const extra of [{ entityId: 'steward' }, { entities: ['steward'] }, { count: 100 }, { intervalMinutes: 0 }, { force: true }, { actorId: 'operator' }]) {
    expect(stagingOperatorRequest.safeParse({ ...request, ...extra }).success).toBe(false);
  }
});


it('reports only fixed failure codes and tool names from private runtime diagnostics', () => {
  const failure = JSON.stringify({ tool: 'repo.patch_commit', code: 'ARGUMENT_SCHEMA', status: 'failed' });
  const secret = 'PRIVATE_FAILURE_ARGUMENT';
  const diagnostics = turnDiagnostics([failure, failure, JSON.stringify({ tool: secret, code: secret, status: 'failed' }), JSON.stringify({ tool: 'repo.read', code: 'EXECUTION_FAILED', status: 'failed', message: secret })]);

  expect(diagnostics.failures).toBe(2);
  expect(diagnostics.failureCodes).toEqual([{ tool: 'repo.patch_commit', code: 'ARGUMENT_SCHEMA', count: 2 }]);
  expect(JSON.stringify(diagnostics)).not.toContain(secret);
});

it('aggregates strict fixed runtime failures without private exception fields', () => {
  const canary = 'PRIVATE-RUNTIME-CANARY';

  const diagnostics = turnDiagnostics([
    JSON.stringify({ type: 'runtime.failure', code: 'MODEL_OUTPUT_LIMIT' }),
    JSON.stringify({ type: 'runtime.failure', code: 'MODEL_OUTPUT_LIMIT' }),
    JSON.stringify({ type: 'runtime.failure', code: 'PERSONAL_WORK_INCOMPLETE' }),
    JSON.stringify({ type: 'runtime.failure', code: 'RUNTIME_FAILED' }),
    JSON.stringify({ type: 'runtime.failure', code: 'RUNTIME_FAILED', message: canary }),
    JSON.stringify({ type: 'runtime.failure', code: canary }),
  ]);

  expect(diagnostics.runtimeFailures).toEqual([{ code: 'MODEL_OUTPUT_LIMIT', count: 2 }, { code: 'PERSONAL_WORK_INCOMPLETE', count: 1 }, { code: 'RUNTIME_FAILED', count: 1 }]);
  expect(JSON.stringify(diagnostics)).not.toContain(canary);
  expect(diagnostics.successfulTools).toEqual([]);
});
