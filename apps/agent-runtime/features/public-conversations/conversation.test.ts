import { expect, it } from 'vitest';
import { createInitialState, WorldEngine } from '../../../../packages/domain/src/index';
import type { ModelResponse } from '../../../../packages/provider-adapters/src/cloudflare';
import { conversationAllowed, conversationCommand, conversationContext, deliverConversation, replayableConversation, type PendingConversation } from './conversation';

function response(argumentsText: string, finish = 'stop'): ModelResponse {
  return { choices: [{ finish_reason: finish, message: { tool_calls: [{ function: { name: 'public.conversation', arguments: argumentsText } }] } }] };
}

it('whitelists public profile and project fields without copying private or simulated records', () => {
  const state = createInitialState();
  state.discussions = [
    { id: 'old', entityId: 'builder-2', body: 'SIMULATION-CANARY', origin: 'simulation', createdAt: state.clock, visibility: 'public' },
    { id: 'legacy', entityId: 'builder-2', body: '[Simulation dialogue LEGACY-CANARY]', createdAt: state.clock, visibility: 'public' },
    { id: 'private', entityId: 'builder-2', body: 'PRIVATE-CANARY', createdAt: state.clock, visibility: 'private' },
    { id: 'real', entityId: 'builder-2', body: 'Consider a useful shared reference.', origin: 'agent', createdAt: state.clock, visibility: 'public' },
    { id: 'own', entityId: 'builder-1', body: 'I can help test that.', origin: 'agent', createdAt: state.clock, visibility: 'public' },
  ];
  const publicWorld = { ...new WorldEngine(state).getPublicState(), memory: 'MEMORY-CANARY', credentials: 'TOKEN-CANARY' };
  const context = conversationContext(publicWorld, 'builder-1');
  expect(context.content).not.toContain('CANARY');
  expect(context.content).toContain('Consider a useful shared reference');
  expect(context.replyTo).toBe('real');
  expect(context.content).toContain('projects');
  expect(() => conversationContext(publicWorld, 'forged')).toThrow('identity');
});

it('only includes eight recent real public posts and independently published production releases', () => {
  const state = createInitialState();
  state.discussions = Array.from({ length: 10 }, (_, index) => ({ id: `post-${index}`, entityId: 'builder-2', body: `Message ${index}`, createdAt: state.clock, visibility: 'public', origin: 'agent' }));
  state.deployments = [{ id: 'sim', entityId: 'builder-1', commit: 'SIMULATION-CANARY', bundleHash: 'hash', version: 2, environment: 'simulation', status: 'published', createdAt: state.clock }];
  const context = conversationContext(new WorldEngine(state).getPublicState(), 'builder-1');
  expect(context.content).not.toContain('CANARY');
  expect(context.content).not.toContain('Message 0');
  expect(context.content).toContain('Message 9');
  expect(context.replyTo).toBe('post-9');
});

it('rejects forged operation, actor, reply target, truncated and oversized model arguments', () => {
  expect(conversationCommand(response('{"body":"A small shared improvement."}'), 'server-target')).toEqual({ type: 'social.post', body: 'A small shared improvement.', replyTo: 'server-target' });

  for (const args of ['{"body":"Hi","actor":"operator"}', '{"body":"Hi","replyTo":"private"}', '{"body":""}', JSON.stringify({ body: 'x'.repeat(1201) })]) expect(() => conversationCommand(response(args))).toThrow();
  expect(() => conversationCommand(response('{"body":"Truncated"}', 'length'))).toThrow();
  const forged = response('{"body":"Hello"}');
  forged.choices[0].message.tool_calls![0].function.name = 'world.command';
  expect(() => conversationCommand(forged)).toThrow();
});

it('blocks simulation, pause, private goals and existing tool continuation', () => {
  expect(conversationAllowed('live', false, false, false)).toBe(true);
  expect(conversationAllowed('simulation', false, false, false)).toBe(false);
  expect(conversationAllowed('live', true, false, false)).toBe(false);
  expect(conversationAllowed('live', false, true, false)).toBe(false);
  expect(conversationAllowed('live', false, false, true)).toBe(false);
});

it('retains an ambiguous public command and replays only its original key without another inference', async () => {
  const pending: PendingConversation = { command: { type: 'social.post', body: 'A shared suggestion' }, key: 'conversation-stable-key', scope: 'public' };
  const saved: (PendingConversation | null)[] = [];
  await expect(deliverConversation(pending, { assertReady: async () => {}, save: item => { saved.push(item); }, command: async () => { throw new Error('Disconnected after commit'); } })).rejects.toThrow('Disconnected');
  expect(saved).toEqual([pending]);
  let observedKey = '';
  await deliverConversation(pending, { assertReady: async () => {}, save: item => { saved.push(item); }, command: async (_command, key) => { observedKey = key;

    return 'receipt'; } });
  expect(observedKey).toBe(pending.key);
  expect(saved.at(-1)).toBeNull();
  expect(replayableConversation({ ...pending, scope: 'private' })).toBe(false);
  expect(replayableConversation({ ...pending, key: 'normal-tool-key' })).toBe(false);
  expect(replayableConversation({ ...pending, authoringScope: { goalId: 'g', taskId: 't', revision: 1, approvalId: 'a' } })).toBe(false);
});

it('rechecks authority before delivery and retains a delivered command if pause occurs before receipt', async () => {
  const pending: PendingConversation = { command: { type: 'social.post', body: 'A shared suggestion' }, key: 'conversation-pause', scope: 'public' };
  let checks = 0;
  const saved: (PendingConversation | null)[] = [];
  await expect(deliverConversation(pending, { assertReady: async () => { if (++checks === 2) throw new Error('Paused'); }, save: item => { saved.push(item); }, command: async () => 'receipt' })).rejects.toThrow('Paused');
  expect(saved).toEqual([pending]);
});

it('includes the selected reply and thread relationships without admitting unclassified history', () => {
  const state = createInitialState();
  state.discussions = [
    { id: 'question', entityId: 'builder-2', body: 'Which part should we test first?', createdAt: state.clock, visibility: 'public', origin: 'agent' },
    { id: 'answer', entityId: 'builder-1', body: 'The search flow.', replyTo: 'question', createdAt: state.clock, visibility: 'public', origin: 'agent' },
    { id: 'legacy', entityId: 'builder-2', body: 'UNCLASSIFIED-CANARY', createdAt: state.clock, visibility: 'public' },
  ];
  const context = conversationContext(new WorldEngine(state).getPublicState(), 'builder-1');
  expect(context.replyTo).toBe('question');
  expect(JSON.parse(context.content).replyTarget.body).toBe('Which part should we test first?');
  expect(context.content).toContain('"replyTo":"question"');
  expect(context.content).not.toContain('UNCLASSIFIED-CANARY');
});
