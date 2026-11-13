import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { authenticateOperator, type AccessConfiguration } from '../../src/auth';
import { cloudCatalogue } from '../../../knowledge/generated/catalogue';
import { commandEnvelopeSchema, type Actor, type Command, type PublicWorld, type WorldState } from '../../../../packages/contracts/src/index';
import type { EntityAgent } from '../../../agent-runtime/src/worker';
import { requireCommandPrivacy, requireExecutionPrivacy } from '../../../agent-runtime/features/agent-turns/privacy';

export interface RemoteWorld {
  inspect(): Promise<WorldState>;
  publicState(): Promise<PublicWorld>;
  command(actor: Actor, command: Command, key: string): Promise<WorldState>;
  ownTask(entityId: string): Promise<{ task: WorldState['tasks'][number]; goal: WorldState['goals'][number]; confirmations: WorldState['confirmations'] } | null>;
}

export type McpEnvironment = AccessConfiguration & {
  ENTITY_MCP_TOKEN_HASHES?: string;
  WORLD: { getByName(name: string): RemoteWorld };
  ENTITY_AGENT?: DurableObjectNamespace<EntityAgent>;
  EXECUTION?: { execute(entityId: string, tool: string, input: string): Promise<string> };
};

const tokenHashesSchema = z.record(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u), z.string().regex(/^[a-f0-9]{64}$/u));

export async function authenticateMcpEntity(request: Request, serializedHashes: string | undefined): Promise<Actor | null> {
  const bearer = /^Bearer ([a-zA-Z0-9_-]{32,256})$/u.exec(request.headers.get('Authorization') ?? '')?.[1];

  if (!bearer || !serializedHashes) return null;
  const hashes = tokenHashesSchema.parse(JSON.parse(serializedHashes));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer));
  const actual = Buffer.from(digest);
  const matches = Object.entries(hashes).filter(([, hash]) => timingSafeEqual(actual, Buffer.from(hash, 'hex')));

  if (matches.length !== 1) return null;

  return { role: 'entity', entityId: matches[0][0] };
}

function ownEntity(actor: Actor): string {
  if (actor.role !== 'entity' || !actor.entityId) throw new Error('Authenticated entity required');

  return actor.entityId;
}

const textResult = (text: string) => ({ content: [{ type: 'text' as const, text }] });

export function createRemoteMcp(actor: Actor, environment: McpEnvironment): McpServer {
  const server = new McpServer({ name: 'arti-world', version: '0.2.0' });
  const world = environment.WORLD.getByName('arti-world');
  server.registerTool('world.inspect', { description: 'Inspect your permitted world projection.', inputSchema: z.object({}).strict() }, async () => textResult(JSON.stringify(actor.role === 'operator' ? await world.inspect() : await world.publicState())));
  server.registerTool('world.command', { description: 'Execute a typed command under the credential-derived actor. Humans cannot post to agent discussions.', inputSchema: commandEnvelopeSchema }, async ({ command, idempotencyKey }) => {
    // MCP can read private memory, so it cannot act as the isolated public writer.
    if (actor.role === 'entity') requireCommandPrivacy(true, command);
    const state = await world.command(actor, command, idempotencyKey);

    return textResult(JSON.stringify(actor.role === 'operator' ? state : { receipt: state.receipts.findLast(receipt => receipt.actorId === actor.entityId), clock: state.clock }));
  });
  server.registerTool('task.inspect', { description: 'Read your own current private assignment and human confirmation answers.', inputSchema: z.object({}).strict() }, async () => textResult(JSON.stringify(await world.ownTask(ownEntity(actor)))));
  server.registerTool('knowledge.search', { description: 'Search canonical guides within your permitted audience.', inputSchema: z.object({ query: z.string().max(200) }).strict() }, async ({ query }) => textResult(JSON.stringify(cloudCatalogue.guides.filter(guide => (actor.role === 'operator' || ['public', 'agent'].includes(guide.audience)) && `${guide.title} ${guide.body}`.toLowerCase().includes(query.toLowerCase())))));

  server.registerTool('memory.read', { description: 'Read your own private memory.', inputSchema: z.object({}).strict() }, async () => {
    if (!environment.ENTITY_AGENT) throw new Error('Memory binding unavailable');
    const { getAgentByName } = await import('agents');
    const agent = await getAgentByName(environment.ENTITY_AGENT, ownEntity(actor));

    return textResult(JSON.stringify(await agent.readMemory()));
  });
  server.registerTool('memory.remember', { description: 'Write your own bounded private memory.', inputSchema: z.object({ key: z.string().min(1).max(100), value: z.string().max(4000) }).strict() }, async ({ key, value }) => {
    if (!environment.ENTITY_AGENT) throw new Error('Memory binding unavailable');
    const { getAgentByName } = await import('agents');
    const agent = await getAgentByName(environment.ENTITY_AGENT, ownEntity(actor));
    await agent.remember(key, value);

    return textResult(JSON.stringify({ saved: true }));
  });

  for (const tool of ['repo.fork', 'repo.read', 'repo.patch_commit', 'execution.request_build', 'research.retrieve', 'research.browser', 'data.get', 'data.put', 'data.delete']) {
    server.registerTool(tool, { description: `Invoke scoped ${tool}; structured input is encoded as JSON and independently validated by execution authority.`, inputSchema: z.object({ input: z.string().max(220_000) }).strict() }, async ({ input }) => {
      if (!environment.EXECUTION) throw new Error('Execution binding unavailable');
      requireExecutionPrivacy(true, tool);

      return textResult(await environment.EXECUTION.execute(ownEntity(actor), tool, input));
    });
  }

  return server;
}

export async function handleRemoteMcp(request: Request, environment: McpEnvironment): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  const origin = request.headers.get('Origin');

  if (!environment.OPERATOR_ORIGIN || new URL(request.url).origin !== environment.OPERATOR_ORIGIN || (origin && origin !== environment.OPERATOR_ORIGIN) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return new Response('Untrusted MCP origin', { status: 403 });
  let actor: Actor;

  try {
    const entity = await authenticateMcpEntity(request, environment.ENTITY_MCP_TOKEN_HASHES);

    if (entity) {
      const state = await environment.WORLD.getByName('arti-world').publicState();

      if (!state.entities.some(item => item.id === entity.entityId)) throw new Error('Unknown entity');
      actor = entity;
    } else {
      await authenticateOperator(request, environment);
      actor = { role: 'operator' };
    }
  } catch { return new Response('MCP authentication required', { status: 403 }); }

  if (!request.body) return new Response('JSON body required', { status: 400 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    for (;;) {
      const chunk = await reader.read();

      if (chunk.done) break;
      length += chunk.value.length;

      if (length > 250_000) return new Response('MCP body too large', { status: 413 });
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }

  const data = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }

  const server = createRemoteMcp(actor, environment);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);

  try {
    const response = await transport.handleRequest(new Request(request, { body: data }));
    const result = new Response(await response.text(), response);
    result.headers.set('Cache-Control', 'no-store');
    result.headers.delete('Set-Cookie');

    return result;
  } finally { await server.close(); }
}
