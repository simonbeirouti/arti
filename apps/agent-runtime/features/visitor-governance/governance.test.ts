import { privateSnapshotSchema } from '../memory/state';
import { expect, it } from 'vitest';
import { inferenceRequest, normalizeScopedArguments } from '../../../../packages/provider-adapters/src/scoped-arguments';
import type { GovernanceAction } from '../../../world/features/visitor-governance/governance';
import type { ModelResponse } from '../../../../packages/provider-adapters/src/cloudflare';
import { deliverGovernance, type PendingGovernance, governanceFailureStages, governanceFailureMetric, governanceCommand, governanceTool, replayableGovernance } from './governance';

function response(argumentsText: string): ModelResponse { return { choices: [{ finish_reason: 'stop', message: { tool_calls: [{ function: { name: 'public.governance', arguments: argumentsText } }] } }] }; }

function normalized(fields: Record<string, string>, action: GovernanceAction): ModelResponse {
  return normalizeScopedArguments({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fields) } }] }, [governanceTool(action)], 'required');
}

it('uses actual flat structured provider content and injects the server-selected vote identity', () => {
  const action = { type: 'suggestion.vote', suggestionId: 'suggestion' } as const;
  const fields = { decision: 'approve', usefulness: '5', fit: '4', feasibility: '3', reason: 'Useful feasible public improvement' };
  expect(governanceCommand(normalized(fields, action), action)).toEqual({ ...action, approved: true, usefulness: 5, fit: 4, feasibility: 3, reason: fields.reason });

  const spoofed: Record<string, string>[] = [{ entityId: 'steward' }, { suggestionId: 'other' }, { command: 'budget.configure' }];

  for (const extra of spoofed) expect(() => governanceCommand(normalized({ ...fields, ...extra }, action), action)).toThrow();
  expect(() => governanceCommand(normalized({ ...fields, feasibility: '6' }, action), action)).toThrow();
  const request = inferenceRequest([{ role: 'system', content: 'Public review' }], [governanceTool(action)], 8192, 'required');
  expect(request.response_format?.json_schema.schema.properties).not.toHaveProperty('command');
  expect(request.response_format?.json_schema.schema.properties.usefulness.enum).toEqual(['0', '1', '2', '3', '4', '5']);
  expect(governanceTool(action).function.parameters.required).toEqual(['decision', 'usefulness', 'fit', 'feasibility', 'reason']);
});

it('builds a proposal review from bounded flat fields and rejects inconsistent duplicates', () => {
  const action = { type: 'suggestion.review', suggestionId: 'server-suggestion' } as const;
  const fields = { decision: 'approve', brief: 'Build a useful public project page', criteria: 'A public heading is visible\nThe page contains an accessible navigation link', reason: 'A useful bounded improvement', duplicateOf: '' };
  expect(governanceCommand(normalized(fields, action), action)).toEqual({ ...action, brief: fields.brief, criteria: ['A public heading is visible', 'The page contains an accessible navigation link'], reason: fields.reason, rejected: false, duplicateOf: undefined });
  expect(() => governanceCommand(normalized({ ...fields, duplicateOf: 'different-suggestion' }, action), action)).toThrow('duplicate');
  expect(() => governanceCommand(normalized({ ...fields, decision: 'duplicate' }, action), action)).toThrow('duplicate');
  expect(governanceCommand(normalized({ ...fields, decision: 'duplicate', duplicateOf: 'existing-suggestion' }, action), action)).toMatchObject({ duplicateOf: 'existing-suggestion', rejected: false });
  expect(() => governanceCommand(normalized({ ...fields, criteria: Array(13).fill('A bounded criterion').join('\n') }, action), action)).toThrow();
  expect(() => governanceCommand(normalized({ ...fields, criteria: 'x'.repeat(501) }, action), action)).toThrow();
});

it('injects trusted task scope and parses only supplied evidence reference fields', () => {
  const action = { type: 'suggestion.task_review', taskId: 'server-task', expectedRevision: 1 } as const;
  const fields = { decision: 'approve', feedback: 'Checked contribution meets its task responsibilities', evidenceIds: 'evidence-one\nevidence-two' };
  expect(governanceCommand(normalized(fields, action), action)).toEqual({ ...action, approved: true, feedback: fields.feedback, evidenceIds: ['evidence-one', 'evidence-two'] });
  expect(() => governanceCommand(normalized({ ...fields, taskId: 'other-task' }, action), action)).toThrow();
  expect(governanceCommand(normalized({ ...fields, decision: 'reject', evidenceIds: '' }, action), action)).toMatchObject({ approved: false, evidenceIds: [] });
});

it('injects the trusted verification observation and permits explicit inconclusive review', () => {
  const action = { type: 'suggestion.verify', goalId: 'goal', expectedRevision: 1, criterionIndex: 0, deploymentId: 'deployment' } as const;
  const fields = { decision: 'verify', assertions: 'The published heading matches the brief' };
  expect(governanceCommand(normalized(fields, action), action, 'trusted-observation')).toEqual({ ...action, observationId: 'trusted-observation', assertions: [fields.assertions] });
  expect(() => governanceCommand(normalized({ ...fields, observationId: 'forged' }, action), action, 'trusted')).toThrow();
  expect(() => governanceCommand(normalized(fields, action), action)).toThrow();
  expect(governanceCommand(normalized({ decision: 'inconclusive', assertions: '' }, action), action, 'trusted')).toBeNull();
  expect(() => governanceCommand(normalized({ decision: 'verify', assertions: '' }, action), action, 'trusted')).toThrow();
  const truncated = normalized(fields, action); truncated.choices[0].finish_reason = 'length';
  expect(() => governanceCommand(truncated, action, 'trusted')).toThrow('Invalid');
});

it('rejects malformed or wrapped provider content and exposes only bounded generic failure stages', () => {
  const action = { type: 'suggestion.vote', suggestionId: 'server-suggestion' } as const;
  expect(() => governanceCommand(response('{"command":"{}"}'), action)).toThrow();
  expect(() => governanceCommand(response('not-json'), action)).toThrow();
  expect(() => normalizeScopedArguments({ choices: [{ message: { content: '{"decision":true}' } }] }, [governanceTool(action)], 'required')).toThrow('argument object');
  expect(governanceFailureStages.map(governanceFailureMetric)).toEqual(['entity.governance_failure.readiness', 'entity.governance_failure.observation', 'entity.governance_failure.model', 'entity.governance_failure.arguments', 'entity.governance_failure.delivery']);
});

it('never replays operator commands under a governance key or accepts unrelated pending commands', () => {
  expect(replayableGovernance({ command: { type: 'suggestion.select' }, key: 'visitor-governance-steward-key' })).toBe(true);
  expect(replayableGovernance({ command: { type: 'world.pause', paused: true }, key: 'visitor-governance-key' })).toBe(false);
  expect(replayableGovernance({ command: { type: 'suggestion.select' }, key: 'conversation-key' })).toBe(false);
});

it('clears confirmed obsolete delivery but retains uncertain delivery and its original key across restart', async () => {
  const original: PendingGovernance = { command: { type: 'suggestion.select' }, key: 'visitor-governance-steward-restart' };
  let saved: PendingGovernance | null = null;
  await expect(deliverGovernance(original, { assertReady: async () => undefined, save: next => { saved = next; }, dispatch: async () => { throw new Error('Lost RPC response'); } })).rejects.toThrow('Lost');
  expect(saved).toEqual(original);
  const deliveries: string[] = [];
  await expect(deliverGovernance(original, { assertReady: async () => undefined, save: next => { saved = next; }, dispatch: async (_command, key) => { deliveries.push(key);

    return false; } })).resolves.toBe(false);
  expect(saved).toBeNull();
  expect(deliveries).toEqual([original.key]);
});

it('preserves governance retries in exported/restored snapshots and accepts earlier snapshots without them', () => {
  const base = { entries: [], running: false, turns: 1, leaseUntil: 0, checkpoint: 0, turnId: null, pendingCommand: null };
  const pending: PendingGovernance = { command: { type: 'suggestion.select' }, key: 'visitor-governance-steward-snapshot' };
  const exported = privateSnapshotSchema.parse({ entityId: 'steward', state: { ...base, governancePending: pending } });
  expect(privateSnapshotSchema.parse(JSON.parse(JSON.stringify(exported))).state.governancePending).toEqual(pending);
  expect(privateSnapshotSchema.parse({ entityId: 'steward', state: base }).state.governancePending).toBeUndefined();
});
