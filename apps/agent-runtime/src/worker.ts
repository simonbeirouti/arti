import { deliverGovernance, governanceFailureMetric, type GovernanceFailureStage, governanceInstructions, governanceTool, governanceCommand, replayableGovernance, type PendingGovernance } from '../features/visitor-governance/governance';
import { assertTurnLease } from '../features/agent-turns/turn-lease';
import { releaseFingerprint } from '../../world/generated/release';
import { assertRuntimeRelease } from '../features/agent-turns/runtime-release';
import { PersonalProgress } from '../features/agent-turns/personal-progress';
import { conversationAllowed, conversationCommand, conversationContext, conversationInstructions, conversationTool, deliverConversation, replayableConversation } from '../features/public-conversations/conversation';
import { ToolPermissionError, runtimeFailureReceipt } from '../features/agent-turns/tool-failures';
/// <reference types="@cloudflare/workers-types" />
import { Agent } from 'agents';
import { privateSnapshotSchema, type PrivateSnapshot } from '../features/memory/state';
import { z } from 'zod';
import { commandSchema, type Command, type PublicAuthoringScope } from '../../../packages/contracts/src/index';
import { LiveGate, WorkersAiAdapter, WorkersAiTurnModel, type ModelTool } from '../../../packages/provider-adapters/src/cloudflare';
import type { ExecutionGateway } from '../../execution/src/index';
import type { WorldDurableObject } from '../../world/src/index';
import { runBoundedTurn, SimulatedModel } from './index';
import { turnInstructions } from '../features/agent-turns/instructions';
import { executionTools, executionInput, isExecutionTool } from '../features/agent-turns/execution-tools';
import { createTurnPrivacy, requireCommandPrivacy, requireExecutionPrivacy, mayReplayCommand, retainPrivateTurnLog, sessionToolAvailable, type PendingScope } from '../features/agent-turns/privacy';
import { publicWriterInstructions, publicWriterModel, publicWriterToolAvailable, publicWriterCommandAvailable, requirePublicWriterCommand, mayReplayPublicWriterCommand } from '../features/agent-turns/public-writer';
import { continuationContext, continuationMatches, turnContinuationSchema, requireStateStorage, type TurnContinuation } from '../features/agent-turns/continuation';
import { freshSlice, finishSliceCall, runBoundedSlice } from '../features/agent-turns/slices';

export type AgentMemory = { governancePending?: PendingGovernance | null; entries: string[]; running: boolean; turns: number; leaseUntil: number; checkpoint: number; turnId: string | null; pendingCommand: { command: Command; key: string; scope?: PendingScope; authoringScope?: PublicAuthoringScope } | null; continuation?: TurnContinuation | null };

type AgentEnvironment = { AI: Ai; WORLD: DurableObjectNamespace<WorldDurableObject>; LIVE_ACTIVATED?: string; MODEL_EVALUATED?: string; DAILY_ALLOWANCE_USD?: string; EXECUTION?: Service<ExecutionGateway>; AI_INPUT_USD_PER_MILLION?: string; AI_OUTPUT_USD_PER_MILLION?: string };

const modelTools: ModelTool[] = [{ type: 'function', function: { name: 'world.inspect', description: 'Read public observed world state', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } } }, { type: 'function', function: { name: 'world.command', description: 'Act as your own identity using a permitted world command encoded as JSON', parameters: { type: 'object', properties: { command: { type: 'string', description: 'JSON world command' } }, required: ['command'] } } }];

modelTools.push(...executionTools);

const toolArgumentsSchema = z.object({ command: z.string() }).strict();

const entityCommands = new Set(['task.claim', 'task.submit', 'task.fail', 'social.post', 'entity.personality', 'entity.profile', 'relationship.record', 'confirmation.request', 'governance.propose', 'governance.appeal', 'governance.moderate']);

const entityCommandSpecification = JSON.stringify({ anyOf: commandSchema.options.filter(option => entityCommands.has(option.shape.type.value)).map(option => z.toJSONSchema(option)) });

const publicCommandSpecification = JSON.stringify({ anyOf: commandSchema.options.filter(option => publicWriterCommandAvailable(option.shape.type.value)).map(option => z.toJSONSchema(option)) });

export class EntityAgent extends Agent<AgentEnvironment, AgentMemory> {
  initialState: AgentMemory = { entries: [], running: false, turns: 0, leaseUntil: 0, checkpoint: 0, turnId: null, pendingCommand: null };
  #saveState(next: AgentMemory): void { requireStateStorage(JSON.stringify(next)); this.setState(next); }
  evaluationFingerprint(): string { return releaseFingerprint; }
  readMemory() { return { entries: [...this.state.entries] }; }
  async remember(key: string, value: string): Promise<void> {
    const entry = z.object({ key: z.string().min(1).max(100), value: z.string().max(8000) }).parse({ key, value });
    const world = await this.env.WORLD.getByName('arti-world').inspect();

    if (world.paused || this.state.running) throw new Error('Memory changes require an idle unpaused entity');
    const prefix = `memory:${entry.key}:`;
    this.#saveState({ ...this.state, entries: [...this.state.entries.filter(item => !item.startsWith(prefix)), `${prefix}${entry.value}`].slice(-50) });
  }
  async exportPrivateState(): Promise<PrivateSnapshot> {
    if (!(await this.env.WORLD.getByName('arti-world').inspect()).paused) throw new Error('Pause world before exporting entity memory');

    if (this.state.running && this.state.leaseUntil > Date.now()) throw new Error('Entity is draining an active turn');

    if (this.state.running) this.#saveState({ ...this.state, running: false, leaseUntil: 0, turnId: crypto.randomUUID() });

    return privateSnapshotSchema.parse({ entityId: this.name, state: { ...this.state, running: false, leaseUntil: 0 } });
  }
  async importPrivateState(input: PrivateSnapshot): Promise<void> {
    const snapshot = privateSnapshotSchema.parse(input);

    if (snapshot.entityId !== this.name || !(await this.env.WORLD.getByName('arti-world').inspect()).paused) throw new Error('Restore requires paused matching identity');

    if (this.state.running && this.state.leaseUntil > Date.now()) throw new Error('Entity has an active turn');
    this.#saveState({ ...snapshot.state, running: false, leaseUntil: 0 });
  }
  recoveryStatus() {
    return { running: this.state.running, leaseExpired: this.state.leaseUntil <= Date.now(), pending: this.state.pendingCommand !== null || this.state.continuation != null, blocked: this.state.continuation?.slice.inFlight != null && this.state.pendingCommand === null, governancePending: replayableGovernance(this.state.governancePending), conversationPending: !this.state.continuation && replayableConversation(this.state.pendingCommand) };
  }
  private acquire(): void {
    if (this.state.running && this.state.leaseUntil > Date.now()) throw new Error('Entity turn already active');
    this.#saveState({ ...this.state, running: true, leaseUntil: Date.now() + 5 * 60000, turnId: crypto.randomUUID() });
  }
  async simulate(): Promise<string> {
    if ((await this.env.WORLD.getByName('arti-world').inspect()).paused) throw new Error('World paused');
    this.acquire();

    try {
      const result = await runBoundedTurn(new SimulatedModel(), { execute: async call => `Simulation scoped tool ${call.name}` }, this.state.entries.slice(-20));
      this.#saveState({ entries: result.history.slice(-50).map(entry => entry.slice(0, 10000)), running: false, turns: this.state.turns + 1, leaseUntil: 0, checkpoint: 0, turnId: null, pendingCommand: null });

      return result.status;
    } finally { if (this.state.running) this.#saveState({ ...this.state, running: false, leaseUntil: 0 }); }
  }
  async runGovernance(): Promise<'completed' | 'blocked'> {
    if (this.env.LIVE_ACTIVATED !== 'true' || this.env.MODEL_EVALUATED !== 'true' || this.state.pendingCommand) return 'blocked';
    const world = this.env.WORLD.getByName('arti-world');
    assertRuntimeRelease(await world.evaluationFingerprint());
    const context = await world.governanceContext(this.name);

    if (!context && !this.state.governancePending) return 'blocked';
    this.acquire();
    const leaseToken = this.state.turnId;
    const assertLease = () => assertTurnLease(this.state, leaseToken, Date.now());

    const assertReady = async () => { assertLease(); const current = await world.inspect();

      if (current.paused || current.mode !== 'live') throw new Error('Governance disabled');
      assertLease(); };

    let failureStage: GovernanceFailureStage = 'readiness';

    try {
      await assertReady();
      let pending = this.state.governancePending;

      if (!pending && context) {
        const action = context.action;
        let observation;

        if (action.type === 'suggestion.verify') {
          if (!this.env.EXECUTION || !action.goalId || !action.expectedRevision) return 'blocked';
          failureStage = 'observation';
          observation = await this.env.EXECUTION.observePublished(this.name, action.goalId, action.expectedRevision);
          assertLease();
        }

        if (action.type === 'suggestion.select' || action.type === 'suggestion.complete') pending = { command: commandSchema.parse(action), key: `visitor-governance-${this.name}-${crypto.randomUUID()}` };
        else {
          const inputRate = Number(this.env.AI_INPUT_USD_PER_MILLION ?? NaN);
          const outputRate = Number(this.env.AI_OUTPUT_USD_PER_MILLION ?? NaN);
          const content = JSON.stringify({ action, publicContext: JSON.parse(context.content), observationId: observation?.id, publishedContent: observation?.content });
          const bytes = new TextEncoder().encode(content + governanceInstructions).byteLength;

          if (bytes > 40000 || ![inputRate, outputRate].every(rate => Number.isFinite(rate) && rate >= 0) || ((bytes + 1024) * inputRate + 8192 * outputRate) / 1_000_000 > 0.01) throw new Error('Governance reservation insufficient');

          const gate = new LiveGate({ activated: true, dailyAllowanceUsd: Number(this.env.DAILY_ALLOWANCE_USD ?? 0) }, {
            reserve: async (id, amount, operation) => { await assertReady();

              return world.reserve(id, amount, `governance-${leaseToken}-${operation}`); }, settle: (id, actual) => world.settle(id, actual),
          });

          const adapter = new WorkersAiAdapter(this.env.AI, gate, '@cf/zai-org/glm-4.7-flash', { inputUsdPerMillion: inputRate, outputUsdPerMillion: outputRate }, usage => world.recordModelUsage(this.name, usage.prompt_tokens, usage.completion_tokens, crypto.randomUUID()), assertLease);
          failureStage = 'model';
          const response = await adapter.run(this.name, [{ role: 'system', content: governanceInstructions }, { role: 'user', content }], 0.01, [governanceTool(action)], 'required');
          assertLease();
          failureStage = 'arguments';
          const command = governanceCommand(response, action, observation?.id);

          if (!command) {
            if (action.type === 'suggestion.verify' && action.goalId && action.expectedRevision) await world.noteVisitorReviewBlocker(this.name, action.goalId, action.expectedRevision);

            return 'blocked';
          }

          pending = { command, key: `visitor-governance-${this.name}-${crypto.randomUUID()}` };
        }
      }

      if (!pending) throw new Error('Missing governance delivery');

      failureStage = 'delivery';

      const delivered = await deliverGovernance(pending, {
        assertReady,
        save: next => { assertLease(); this.#saveState({ ...this.state, governancePending: next }); },
        dispatch: async (command, key) => Boolean(await world.governanceCommand(this.name, command, key)),
      });

      return delivered ? 'completed' : 'blocked';
    } catch { if (this.state.turnId === leaseToken) {
      await world.noteOperation('entity.governance_failure');
      await world.noteOperation(governanceFailureMetric(failureStage));

      if (context?.action.type === 'suggestion.verify' && context.action.goalId && context.action.expectedRevision) await world.noteVisitorReviewBlocker(this.name, context.action.goalId, context.action.expectedRevision).catch(() => undefined);
    }

      return 'blocked';
    } finally { if (this.state.turnId === leaseToken) this.#saveState({ ...this.state, running: false, leaseUntil: 0 }); }
  }
  async runConversation(): Promise<'completed' | 'blocked'> {
    if (this.env.LIVE_ACTIVATED !== 'true' || this.env.MODEL_EVALUATED !== 'true') return 'blocked';
    const world = this.env.WORLD.getByName('arti-world');
    assertRuntimeRelease(await world.evaluationFingerprint());

    const permitted = async () => {
      const current = await world.inspect();

      return !current.visitorBuild?.sharedOnly && conversationAllowed(current.mode, current.paused, current.goals.some(goal => !['completed', 'cancelled'].includes(goal.status)), this.state.continuation != null);
    };

    if (!(await permitted()) || this.state.pendingCommand && !replayableConversation(this.state.pendingCommand)) return 'blocked';
    this.acquire();
    const leaseToken = this.state.turnId;
    const assertLease = () => assertTurnLease(this.state, leaseToken, Date.now());

    const assertReady = async () => { assertLease();

      if (!(await permitted())) throw new Error('Public conversation disabled');
      assertLease(); };

    try {
      await assertReady();
      await world.noteEntityTurn(this.name);
      assertLease();
      let pending = this.state.pendingCommand;

      if (!pending) {
        const context = conversationContext(await world.publicState(), this.name);
        const instructions = conversationInstructions;
        const inputRate = Number(this.env.AI_INPUT_USD_PER_MILLION ?? NaN);
        const outputRate = Number(this.env.AI_OUTPUT_USD_PER_MILLION ?? NaN);
        const bytes = new TextEncoder().encode(context.content + instructions).byteLength;

        if (bytes > 40_000 || ![inputRate, outputRate].every(rate => Number.isFinite(rate) && rate >= 0) || ((bytes + 1024) * inputRate + 8192 * outputRate) / 1_000_000 > 0.01) throw new Error('Conversation reservation is insufficient');

        const gate = new LiveGate({ activated: true, dailyAllowanceUsd: Number(this.env.DAILY_ALLOWANCE_USD ?? 0) }, {
          reserve: async (id, amount, operation) => { await assertReady();

            return world.reserve(id, amount, `conversation-${leaseToken}-${operation}`); },
          settle: (id, actual) => world.settle(id, actual),
        });

        const adapter = new WorkersAiAdapter(this.env.AI, gate, '@cf/zai-org/glm-4.7-flash', { inputUsdPerMillion: inputRate, outputUsdPerMillion: outputRate }, usage => world.recordModelUsage(this.name, usage.prompt_tokens, usage.completion_tokens, crypto.randomUUID()), assertLease);
        const response = await adapter.run(this.name, [{ role: 'system', content: instructions }, { role: 'user', content: context.content }], 0.01, [conversationTool], 'required');
        assertLease();
        pending = { command: conversationCommand(response, context.replyTo), key: `conversation-${this.name}-${crypto.randomUUID()}`, scope: 'public' };
      }

      await deliverConversation(pending, {
        assertReady,
        save: (next, receipt) => {
          assertLease();
          this.#saveState({ ...this.state, pendingCommand: next, entries: receipt ? retainPrivateTurnLog(this.state.entries, [receipt]) : this.state.entries });
        },
        command: async (command, key) => {
          const updated = await world.conversation(this.name, command, key);

          return JSON.stringify({ type: 'conversation.receipt', receipt: updated.receipts.at(-1), clock: updated.clock });
        },
      });
      this.#saveState({ ...this.state, turns: this.state.turns + 1 });

      return 'completed';
    } catch {
      if (this.state.turnId === leaseToken) await world.noteOperation('entity.conversation_failure');

      return 'blocked';
    } finally { if (this.state.turnId === leaseToken) this.#saveState({ ...this.state, running: false, leaseUntil: 0 }); }
  }
  async runLive(): Promise<string> {
    if (this.state.governancePending) return 'blocked';

    if (this.env.LIVE_ACTIVATED !== 'true' || this.env.MODEL_EVALUATED !== 'true') throw new Error('Live activation and model evaluation required');
    const world = this.env.WORLD.getByName('arti-world');
    assertRuntimeRelease(await world.evaluationFingerprint());

    if ((await world.inspect()).visitorBuild?.sharedOnly && !(await world.ownPublicTask(this.name))) return 'blocked';

    if (!this.state.continuation && !(await world.ownPublicTask(this.name)) && !(await world.ownTask(this.name))) {
      if (this.state.pendingCommand && !replayableConversation(this.state.pendingCommand)) return 'blocked';

      return this.runConversation();
    }

    this.acquire();
    const leaseToken = this.state.turnId;
    const assertLease = () => assertTurnLease(this.state, leaseToken, Date.now());
    const entityId = this.name;
    const logicalId = this.state.continuation?.id ?? crypto.randomUUID();
    const turnId = `${entityId}-${this.state.turns}-${logicalId}`;
    let authoringScope: PublicAuthoringScope | undefined;
    let authoringFinished = false;
    let sessionValidated = false;
    let inference = 0;

    const authority = {
      reserve: async (id: string, amount: number, operation: string) => { assertLease();

 return world.reserve(id, amount, `${turnId}-${leaseToken}-${operation}-${inference++}`); },
      settle: async (id: string, actual: number | null) => world.settle(id, actual),
    };

    const gate = new LiveGate({ activated: true, dailyAllowanceUsd: Number(this.env.DAILY_ALLOWANCE_USD ?? 0) }, authority);

    try {
      assertLease();
      await world.noteEntityTurn(entityId);
      const current = await world.inspect();
      assertLease();

      if (current.paused || current.mode !== 'live') throw new Error('World live activity disabled');
      const entity = current.entities.find(item => item.id === entityId);

      if (!entity) throw new Error('Unknown durable entity identity');
      const privacy = createTurnPrivacy(current.goals.some(goal => !['completed', 'cancelled'].includes(goal.status)));
      const publicAssignment = await world.ownPublicTask(entityId);
      const assignment = publicAssignment ? null : await world.ownTask(entityId);
      assertLease();
      authoringScope = publicAssignment?.scope;
      const context = continuationContext({ entityId, siteVersion: entity.siteVersion, privateWork: privacy.privateWork, goals: current.goals.flatMap(goal => !['completed', 'cancelled'].includes(goal.status) ? [{ id: goal.id, revision: goal.revision, status: goal.status }] : []), assignment: assignment ? { id: assignment.task.id, goalId: assignment.task.goalId, revision: assignment.task.revision } : null, authoringScope });

      if (this.state.continuation && !continuationMatches(this.state.continuation, context, releaseFingerprint)) {
        this.#saveState({ ...this.state, entries: retainPrivateTurnLog(this.state.entries, [JSON.stringify({ type: 'turn.invalidated', pendingCommand: this.state.pendingCommand })]), continuation: null, pendingCommand: null });
        throw new Error('Continuation context changed');
      }

      sessionValidated = true;

      if (authoringScope) await world.authorizePublicTurn(entityId, authoringScope);

      assertLease();

      if (this.state.pendingCommand) {
        const pending = this.state.pendingCommand;

        const replay = authoringScope ? mayReplayPublicWriterCommand(authoringScope, pending.authoringScope, pending.scope, pending.command) : !pending.authoringScope && mayReplayCommand(privacy.privateWork, pending.command, pending.scope);

        if (replay) {
          const inFlight = this.state.continuation?.slice.inFlight;

          if (inFlight) {
            if (inFlight.name !== 'world.command') throw new Error('Pending command does not match continuation');
            const expected = toolArgumentsSchema.parse(JSON.parse(inFlight.arguments));

            if (JSON.stringify(commandSchema.parse(JSON.parse(expected.command))) !== JSON.stringify(pending.command)) throw new Error('Pending command does not match continuation');
          }

          const replayed = authoringScope ? await world.publicCommand(entityId, authoringScope, pending.command, pending.key) : await world.command({ role: 'entity', entityId }, pending.command, pending.key);

          assertLease();

          if (authoringScope && (pending.command.type === 'task.submit' || pending.command.type === 'task.fail')) authoringFinished = true;
          const continuation = this.state.continuation ? turnContinuationSchema.parse(this.state.continuation) : null;

          if (continuation?.slice.inFlight?.name === 'world.command') {
            finishSliceCall(continuation.slice, JSON.stringify({ receipt: replayed.receipts.at(-1), clock: replayed.clock }));
          }

          this.#saveState({ ...this.state, continuation, pendingCommand: null, checkpoint: this.state.checkpoint + 1, entries: retainPrivateTurnLog(this.state.entries, [JSON.stringify({ receipt: replayed.receipts.at(-1) })]) });
        } else {
          this.#saveState({ ...this.state, pendingCommand: null, entries: retainPrivateTurnLog(this.state.entries, [JSON.stringify({ quarantinedPendingCommand: pending, reason: 'Public replay origin or session is not safe' })]) });
        }
      }

      if (this.state.continuation?.slice.inFlight) throw new Error('Ambiguous execution delivery requires operator review');

      const retainedHistory = [...this.state.entries];

      assertLease();

      if (assignment?.task.status === 'queued') await world.command({ role: 'entity', entityId }, { type: 'task.claim', taskId: assignment.task.id, expectedRevision: assignment.goal.revision }, `${turnId}-claim`);

      assertLease();

      if (!authoringFinished && publicAssignment?.taskStatus === 'queued') await world.publicCommand(entityId, publicAssignment.scope, { type: 'task.claim', taskId: publicAssignment.scope.taskId, expectedRevision: publicAssignment.scope.revision }, `${turnId}-claim`);
      const instructions = publicAssignment ? publicWriterInstructions(entity, publicAssignment, publicCommandSpecification) : turnInstructions(entity, assignment, current.goals.some(goal => !['completed', 'cancelled'].includes(goal.status)), entityCommandSpecification);

      const continuation = turnContinuationSchema.parse(this.state.continuation ?? {
        id: logicalId, release: releaseFingerprint, context, privateWork: privacy.privateWork, instructions,
        profile: { id: entity.id, name: entity.name, role: entity.role, personality: [...entity.personality] }, authoringScope,
        personal: null,
        slice: freshSlice(),
      });

      const persist = (next: TurnContinuation, checkpoint = false) => {
        assertLease();
        const finishedCall = checkpoint && next.slice.inFlight === null;
        const state = { ...this.state, continuation: turnContinuationSchema.parse(next), pendingCommand: finishedCall ? null : this.state.pendingCommand, checkpoint: checkpoint ? next.slice.steps : this.state.checkpoint, entries: finishedCall ? retainPrivateTurnLog(this.state.entries, [next.slice.history.at(-1) ?? '']) : this.state.entries };
        requireStateStorage(JSON.stringify(state));
        this.#saveState(state);
      };

      persist(continuation);
      const inputRate = Number(this.env.AI_INPUT_USD_PER_MILLION ?? NaN);
      const outputRate = Number(this.env.AI_OUTPUT_USD_PER_MILLION ?? NaN);
      const pricing = [inputRate, outputRate].every(rate => Number.isFinite(rate) && rate >= 0) ? { inputUsdPerMillion: inputRate, outputUsdPerMillion: outputRate } : undefined;
      const adapter = new WorkersAiAdapter(this.env.AI, gate, '@cf/zai-org/glm-4.7-flash', pricing, async usage => { await world.recordModelUsage(entityId, usage.prompt_tokens, usage.completion_tokens, crypto.randomUUID()); }, assertLease);
      const personal = continuation.personal ? PersonalProgress.restore(continuation.personal) : null;
      const availableTools = modelTools.filter(tool => publicAssignment ? publicWriterToolAvailable(tool.function.name) : sessionToolAvailable(privacy.privateWork, tool.function.name));
      const turnModel = new WorkersAiTurnModel(adapter, entityId, personal ? personal.instructions(continuation.profile) : continuation.instructions, availableTools, 0.02, personal ? () => ({ toolChoice: 'required', instructions: personal.instructions(continuation.profile), tools: availableTools.flatMap(tool => personal.tools().includes(tool.function.name) ? [personal.toolSchema(tool)] : []) }) : undefined);
      const currentAuthoringScope = authoringScope;
      const scopedModel = currentAuthoringScope ? publicWriterModel(turnModel, () => world.authorizePublicTurn(entityId, currentAuthoringScope), () => authoringFinished) : personal ? personal.model(turnModel) : turnModel;

      const model = { next: async (history: string[]) => { try {
        assertLease();
        const response = await scopedModel.next(history);
        assertLease();

        return response;
      } catch (error) { if (this.state.turnId === leaseToken) await world.noteOperation('model.failure'); throw error; } } };

      const result = await runBoundedSlice(model, { execute: async call => {
        let effectsDispatched = false;

        try {
          assertLease();
          const state = await world.inspect();
          assertLease();

          if (state.paused || state.mode !== 'live') throw new Error('World paused');

          if (authoringScope) await world.authorizePublicTurn(entityId, authoringScope);
          assertLease();
          const privateWork = privacy.privateWork || state.goals.some(goal => !['completed', 'cancelled'].includes(goal.status));
          personal?.require(call.name, call.arguments);
          let observation: string;

          if (call.name === 'world.inspect') observation = JSON.stringify(await world.publicState());
          else if (call.name === 'world.command') {
            const args = toolArgumentsSchema.parse(JSON.parse(call.arguments));
            const command = commandSchema.parse(JSON.parse(args.command));

            if (authoringScope) requirePublicWriterCommand(authoringScope, command);
            else requireCommandPrivacy(privateWork, command);
            const key = `${turnId}-tool-${continuation.slice.steps}`;
            this.#saveState({ ...this.state, pendingCommand: { command, key, scope: authoringScope ? 'public' : privateWork ? 'private' : 'public', authoringScope } });
            effectsDispatched = true;
            const updated = authoringScope ? await world.publicCommand(entityId, authoringScope, command, key) : await world.command({ role: 'entity', entityId }, command, key);

            if (authoringScope && (command.type === 'task.submit' || command.type === 'task.fail')) authoringFinished = true;
            observation = JSON.stringify({ receipt: updated.receipts.at(-1), clock: updated.clock });
          } else if (isExecutionTool(call.name) && this.env.EXECUTION) {
            if (authoringScope) {
              if (!publicWriterToolAvailable(call.name)) throw new ToolPermissionError('Tool unavailable to public authoring');
            } else requireExecutionPrivacy(privateWork, call.name);
            const input = executionInput(call.name, call.arguments);
            effectsDispatched = true;
            observation = await this.env.EXECUTION.execute(entityId, call.name, input, authoringScope);
          } else throw new ToolPermissionError('Tool not permitted');
          assertLease();
          personal?.succeeded(call.name, call.arguments, observation);

          return observation;
        } catch (error) {
          // Even a local receipt validation failure after dispatch can follow an applied mutation.
          if (effectsDispatched) throw new Error('Tool delivery outcome requires reconciliation');
          throw error;
        }
      } }, continuation.slice, slice => {
        assertLease();
        continuation.slice = slice; continuation.personal = personal?.checkpoint() ?? null;
        persist({ ...continuation }, true);
      });

      if (authoringFinished || personal?.tools().length === 0) result.status = 'completed';

      const completedWorld = await world.inspect();
      assertLease();

      if (completedWorld.paused) throw new Error('Turn superseded or paused');

      if (result.status === 'pending') {
        this.#saveState({ ...this.state, running: false, leaseUntil: 0 });

        return 'pending';
      }

      if (result.status === 'blocked' && assignment) {
        const currentAssignment = await world.ownTask(entityId);
        assertLease();

        if (currentAssignment?.task.id === assignment.task.id && currentAssignment.task.status === 'running') await world.command({ role: 'entity', entityId }, { type: 'task.fail', taskId: assignment.task.id, expectedRevision: currentAssignment.goal.revision, reason: 'Bounded tool turn stopped after three unsuccessful calls' }, `${turnId}-failure`);
      }

      assertLease();

      if (result.status === 'blocked' && authoringScope) {
        await world.publicCommand(entityId, authoringScope, { type: 'task.fail', taskId: authoringScope.taskId, expectedRevision: authoringScope.revision, reason: 'Public authoring stopped after three unsuccessful calls' }, `${turnId}-failure`).catch(() => undefined);
      }

      assertLease();
      this.#saveState({ entries: retainPrivateTurnLog(retainedHistory, result.state.history), running: false, turns: this.state.turns + 1, leaseUntil: 0, checkpoint: 0, turnId: null, pendingCommand: null, continuation: null });

      return result.status;
    } catch (error) {
      if (this.state.turnId !== leaseToken) throw error;
      this.#saveState({ ...this.state, entries: retainPrivateTurnLog(this.state.entries, [JSON.stringify(runtimeFailureReceipt(error instanceof Error ? error : new Error('Unknown runtime failure')))]) });
      const ambiguousDelivery = this.state.continuation?.slice.inFlight != null;
      const currentAssignment = !sessionValidated || authoringScope || ambiguousDelivery ? null : await world.ownTask(entityId);

      if (this.state.turnId !== leaseToken) throw error;

      if (currentAssignment?.task.status === 'running') await world.command({ role: 'entity', entityId }, { type: 'task.fail', taskId: currentAssignment.task.id, expectedRevision: currentAssignment.goal.revision, reason: 'Live turn interrupted by a model or execution failure' }, `${turnId}-interrupted`);

      if (this.state.turnId !== leaseToken) throw error;

      if (sessionValidated && authoringScope && !ambiguousDelivery) await world.publicCommand(entityId, authoringScope, { type: 'task.fail', taskId: authoringScope.taskId, expectedRevision: authoringScope.revision, reason: 'Public authoring interrupted by a model or execution failure' }, `${turnId}-interrupted`).catch(() => undefined);

      // Preserve ambiguous command delivery for idempotent replay after eviction or interruption.
      if (this.state.turnId !== leaseToken) throw error;

      if (!this.state.pendingCommand && !ambiguousDelivery) this.#saveState({ ...this.state, turns: this.state.turns + 1, turnId: null, checkpoint: 0, running: false, leaseUntil: 0, continuation: null });
      else this.#saveState({ ...this.state, running: false, leaseUntil: 0 });
      throw error;
    } finally { if (this.state.turnId === leaseToken) this.#saveState({ ...this.state, running: false, leaseUntil: 0 }); }
  }
}

export default { fetch: () => new Response('Entity runtime accepts internal RPC only', { status: 404 }) };
