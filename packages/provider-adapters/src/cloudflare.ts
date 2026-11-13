/// <reference types="@cloudflare/workers-types" />
import { z } from 'zod';
import { inferenceRequest, normalizeScopedArguments } from './scoped-arguments';
import type { ModelTurn, TurnModel } from '../../../apps/agent-runtime/src/index';

export type LiveConfiguration = { activated: boolean; dailyAllowanceUsd: number };

export type Reservation = { id: string };

export interface AllowanceAuthority {
  reserve(entityId: string, estimatedUsd: number, operation: string): Promise<Reservation>;
  settle(reservationId: string, actualUsd: number | null): Promise<void>;
}

export class LiveGate {
  constructor(private readonly configuration: LiveConfiguration, private readonly authority: AllowanceAuthority) {}
  async run<T>(entityId: string, estimate: number, operation: string, action: () => Promise<T>, measuredCost?: (result: T) => number | null): Promise<T> {
    if (!this.configuration.activated || !Number.isFinite(this.configuration.dailyAllowanceUsd) || this.configuration.dailyAllowanceUsd <= 0) throw new Error('Live activity disabled');

    if (!Number.isFinite(estimate) || estimate <= 0) throw new Error('A positive cost reservation is required');
    const reservation = await this.authority.reserve(entityId, estimate, `${operation}:${crypto.randomUUID()}`);

    let actualUsd: number | null = null;

    try {
      const result = await action();
      actualUsd = measuredCost ? measuredCost(result) : null;

      return result;
    } finally {
      // Unknown provider cost must remain charged/reserved conservatively by authority.
      await this.authority.settle(reservation.id, actualUsd);
    }
  }
}

type RepoResult = { name: string; remote: string; token: string; defaultBranch: string };

interface ArtifactRepository extends Disposable {
  createToken(scope: 'read' | 'write', ttl: number): Promise<{ plaintext: string; expiresAt: string }>;
  fork(name: string, options: { defaultBranchOnly: boolean; readOnly: boolean }): Promise<RepoResult>;
  readFile(options: { ref: string; path: string }): Promise<Blob | null>;
}

export interface ArtifactsBinding {
  create(name: string, options: { setDefaultBranch: string; readOnly: boolean }): Promise<RepoResult>;
  get(name: string): Promise<ArtifactRepository>;
}

function identifier(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(value)) throw new Error('Invalid provider identifier');

  return value;
}

export class CloudflareArtifactsAdapter {
  constructor(private readonly binding: ArtifactsBinding, private readonly gate: LiveGate) {}
  create(entityId: string): Promise<RepoResult> {
    return this.gate.run(entityId, 0.001, 'artifacts.create', () => this.binding.create(identifier(entityId), { setDefaultBranch: 'main', readOnly: false }));
  }
  async fork(entityId: string, taskId: string): Promise<{ name: string; remote: string; token: string; expiresAt: string }> {
    return this.gate.run(entityId, 0.001, 'artifacts.fork', async () => {
      using canonical = await this.binding.get(identifier(entityId));
      const fork = await canonical.fork(`${identifier(entityId)}-${identifier(taskId)}`, { defaultBranchOnly: true, readOnly: false });
      using repository = await this.binding.get(fork.name);
      const token = await repository.createToken('write', 900);

      return { name: fork.name, remote: fork.remote, token: token.plaintext, expiresAt: token.expiresAt };
    });
  }
  async read(entityId: string, commit: string, path: string): Promise<Blob | null> {
    if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-zA-Z0-9/_.-]+$/.test(path) || path.includes('..')) throw new Error('Invalid pinned reference');

    return this.gate.run(entityId, 0.001, 'artifacts.read', async () => {
      using repository = await this.binding.get(identifier(entityId));

      return repository.readFile({ ref: commit, path });
    });
  }
}

const modelResponseSchema = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullable().optional(), message: z.object({ content: z.string().nullable().optional(), tool_calls: z.array(z.object({ function: z.object({ name: z.string(), arguments: z.string() }) })).optional() }) })).min(1), usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).optional() });

export type ModelResponse = z.infer<typeof modelResponseSchema>;

export type AiBinding = Pick<Ai, 'run'>;

export type ModelTool = { type: 'function'; function: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, { type: 'string'; enum?: string[]; description?: string; minLength?: number; maxLength?: number; pattern?: string; format?: string }>; required: string[]; additionalProperties?: false } } };

export type ModelPricing = { inputUsdPerMillion: number; outputUsdPerMillion: number };

export function measuredModelCost(response: ModelResponse, pricing?: ModelPricing): number | null {
  if (!response.usage || !pricing) return null;
  const { inputUsdPerMillion, outputUsdPerMillion } = pricing;

  if (![inputUsdPerMillion, outputUsdPerMillion].every(rate => Number.isFinite(rate) && rate >= 0)) throw new Error('Invalid configured model pricing');

  return (response.usage.prompt_tokens * inputUsdPerMillion + response.usage.completion_tokens * outputUsdPerMillion) / 1_000_000;
}

export class WorkersAiAdapter {
  constructor(private readonly ai: AiBinding, private readonly gate: LiveGate, private readonly model: keyof AiModels = '@cf/zai-org/glm-4.7-flash', private readonly pricing?: ModelPricing, private readonly onUsage?: (usage: NonNullable<ModelResponse['usage']>) => Promise<void>, private readonly assertDispatch?: () => void) {}
  run(entityId: string, messages: { role: 'system' | 'user' | 'assistant'; content: string }[], estimatedUsd: number, tools: ModelTool[] = [], toolChoice?: 'required'): Promise<ModelResponse> {
    if (toolChoice === 'required' && tools.length === 0) throw new Error('Required model tool set is empty');

    return this.gate.run(entityId, estimatedUsd, 'model.infer', async () => {
      this.assertDispatch?.();
      const input = inferenceRequest(messages, tools, 8192, toolChoice);

      const response = modelResponseSchema.parse(await this.ai.run(this.model, input));

      if (response.usage && this.onUsage) await this.onUsage(response.usage);

      return response;
    }, response => measuredModelCost(response, this.pricing)).then(response => normalizeScopedArguments(response, tools, toolChoice));
  }
}

export class ModelOutputLimitError extends Error {
  constructor() { super('MODEL_OUTPUT_LIMIT'); }
}

export type ModelTurnInput = { instructions: string; tools: ModelTool[]; toolChoice?: 'required' };

/** A scoped executor validates every model-proposed tool call independently. */
export class WorkersAiTurnModel implements TurnModel {
  constructor(private readonly adapter: WorkersAiAdapter, private readonly entityId: string, private readonly instructions: string, private readonly tools: ModelTool[], private readonly estimatedUsd = 0.02, private readonly select?: () => ModelTurnInput) {}
  async next(history: string[]): Promise<ModelTurn> {
    const input: ModelTurnInput = this.select?.() ?? { instructions: this.instructions, tools: this.tools };

    const response = await this.adapter.run(this.entityId, [
      { role: 'system', content: input.instructions },
      { role: 'user', content: JSON.stringify({ observations: history }) },
    ], this.estimatedUsd, input.tools, input.toolChoice);

    if (response.choices.some(choice => choice.finish_reason === 'length')) throw new ModelOutputLimitError();
    const message = response.choices[0].message;

    return { text: message.content ?? '', calls: (message.tool_calls ?? []).map((call) => ({ name: call.function.name, arguments: call.function.arguments })) };
  }
}

const moduleSchema = z.object({ name: z.string().regex(/^[a-zA-Z0-9_./-]+$/), content: z.string().max(5_000_000), type: z.enum(['application/javascript+module', 'text/plain', 'application/wasm']) }).strict();

const bundleSchema = z.object({ mainModule: z.string(), modules: z.array(moduleSchema).min(1).max(100) }).strict();

export type WorkerBundle = z.infer<typeof bundleSchema>;

export class TrustedUploader {
  constructor(private readonly accountId: string, private readonly token: string, private readonly gate: Pick<LiveGate, 'run'>, private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}
  async upload(entityId: string, namespace: string, input: WorkerBundle, scriptName = entityId): Promise<void> {
    const bundle = bundleSchema.parse(input);
    const names = new Set<string>();

    for (const module of bundle.modules) {
      if (module.name.includes('..') || module.name.startsWith('/') || names.has(module.name) || module.type === 'application/wasm') throw new Error('Invalid or unsupported module');
      names.add(module.name);
    }

    if (!names.has(bundle.mainModule)) throw new Error('Missing main module');
    await this.gate.run(entityId, 0.001, 'deployment.upload', async () => {
      const form = new FormData();
      // Bindings originate only in trusted platform code. Initial release grants none.
      form.append('metadata', new Blob([JSON.stringify({ main_module: bundle.mainModule, compatibility_date: '2026-10-12', bindings: [] })], { type: 'application/json' }));

      for (const module of bundle.modules) form.append(module.name, new Blob([module.content], { type: module.type }), module.name);

      const response = await this.fetcher(`https://api.cloudflare.com/client/v4/accounts/${identifier(this.accountId)}/workers/dispatch/namespaces/${identifier(namespace)}/scripts/${identifier(scriptName)}`, {
        method: 'PUT', signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${this.token}` }, body: form,
      });

      if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      const body = z.object({ success: z.boolean() }).parse(await response.json());

      if (!body.success) throw new Error('Provider rejected upload');
    });
  }
}

export class ResearchAdapter {
  constructor(private readonly allowedHosts: readonly string[], private readonly gate: LiveGate, private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}
  async retrieve(entityId: string, rawUrl: string): Promise<{ url: string; text: string; retrievedAt: string; trust: 'untrusted' }> {
    const url = new URL(rawUrl);

    if (url.protocol !== 'https:' || url.username || url.password || url.port || !this.allowedHosts.includes(url.hostname)) throw new Error('Research origin is not approved');

    return this.gate.run(entityId, 0.001, 'research.retrieve', async () => {
      const response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Accept: 'text/plain,text/html,application/json' } });

      if (!response.ok || !/^(text\/|application\/json)/.test(response.headers.get('content-type') ?? '')) throw new Error('Unsupported research response');

      if (!response.body) throw new Error('Empty research body');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;

      try {
        for (;;) {
          const result = await reader.read();

          if (result.done) break;
          size += result.value.length;

          if (size > 1_000_000) throw new Error('Research response too large');
          chunks.push(result.value);
        }
      } finally { await reader.cancel(); }

      const joined = new Uint8Array(size);
      let offset = 0;

      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }

      return { url: url.href, text: new TextDecoder().decode(joined), retrievedAt: new Date().toISOString(), trust: 'untrusted' };
    });
  }
}
