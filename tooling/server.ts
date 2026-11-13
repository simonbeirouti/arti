import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z, ZodError } from 'zod';
import { commandEnvelopeSchema } from '../packages/contracts/src/index';
import { WorldError } from '../packages/domain/src/index';
import { loadCatalogue, publicCatalogue } from '../apps/knowledge/src/catalog';
import { buildPublicKnowledge } from '../apps/knowledge/features/publication/build';
import { localVisitorHttp } from './visitor-http';
import { ApiService } from './api-service';
import { LocalAuthentication, allowedOrigin } from './auth';
import { EntityTools } from './entity-tools';
import { serveMcp } from './mcp';
import { LocalGlmRunner } from './features/local-glm/runner';
import { cloudflareLocalModel } from './features/local-glm/provider';
import type { LocalGlmConfiguration } from './features/local-glm/configuration';

function send(response: ServerResponse, status: number, body: string, type = 'application/json'): void {
  response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  response.end(body);
}

async function body(request: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  let length = 0;

  for await (const part of request) {
    const chunk = Buffer.from(part);
    length += chunk.length;

    if (length > 1024 * 1024) throw new Error('Request exceeds size limit');

    parts.push(chunk);
  }

  return Buffer.concat(parts).toString('utf8');
}

const tokenSchema = z.record(z.string(), z.string().min(32));

async function agentTokens(dataRoot: string, ids: string[]): Promise<Map<string, string>> {
  const path = join(dataRoot, 'agent-tokens.json');

  try {
    return new Map(Object.entries(tokenSchema.parse(JSON.parse(await readFile(path, 'utf8')))));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  const values = Object.fromEntries(ids.map((id) => [id, randomBytes(32).toString('hex')]));
  await writeFile(path, JSON.stringify(values), { mode: 0o600, flag: 'wx' });

  return new Map(Object.entries(values));
}

type LocalPorts = { api: number; knowledge: number; siteStart: number };

export async function startServers(root: string, dataRoot: string, autoTickMs = 2000, ports: LocalPorts = { api: 8787, knowledge: 4174, siteStart: 4201 }, localGlm?: LocalGlmConfiguration) {
  await mkdir(dataRoot, { recursive: true });
  const lock = join(dataRoot, 'server.lock');
  await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  const cleanup: (() => void | Promise<void>)[] = [];

  try {
    const running = await startUnlockedServers(root, dataRoot, autoTickMs, ports, (action) => cleanup.push(action), localGlm);

    return {
      service: running.service,
      apiUrl: running.apiUrl,
      async close() {
        try { await running.close(); } finally { await unlink(lock); }
      },
    };
  } catch (error) {
    for (const action of cleanup.reverse()) await action();
    await unlink(lock);
    throw error;
  }
}

async function startUnlockedServers(root: string, dataRoot: string, autoTickMs: number, ports: LocalPorts, onCleanup: (action: () => void | Promise<void>) => void, localGlm?: LocalGlmConfiguration) {
  const service = new ApiService(dataRoot, localGlm?.dailyUsd);
  onCleanup(() => service.close());
  await service.initialize();
  const visitorHttp = localVisitorHttp(dataRoot, service);
  onCleanup(() => visitorHttp.close());
  const tools = new EntityTools(dataRoot, service.execution, () => service.getState());
  onCleanup(() => tools.close());
  const authentication = new LocalAuthentication(await agentTokens(dataRoot, service.getState().entities.map((entity) => entity.id)));
  const catalogue = await loadCatalogue(root);

  const api = createServer((request, response) => { void route(request, response).catch((error: Error) => {
    const status = error instanceof ZodError ? 400 : error instanceof WorldError ? ({ forbidden: 403, unauthorized: 401, not_found: 404, stale_revision: 409, idempotency_conflict: 409 })[error.code] ?? 409 : 400;

    if (!response.headersSent) send(response, status, JSON.stringify({ error: error.message }));
    else response.end();
  }); });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost:8787');
    const host = request.headers.host?.split(':')[0];

    if (!['localhost', '127.0.0.1'].includes(host ?? '') || !allowedOrigin(request, 5173)) return send(response, 403, JSON.stringify({ error: 'Untrusted origin or hostname' }));

    if (await visitorHttp.handle(request, response)) return;

    if (url.pathname === '/api/v1/health') return send(response, 200, JSON.stringify({ status: 'ok', mode: 'simulation', paidActivity: !!localGlm, model: localGlm ? '@cf/zai-org/glm-4.7-flash' : undefined }));

    if (url.pathname === '/api/v1/public') return send(response, 200, JSON.stringify(service.getPublicState()));

    if (url.pathname === '/api/v1/public/catalog') return send(response, 200, JSON.stringify(publicCatalogue(catalogue)));

    if (url.pathname === '/api/v1/session' && request.method === 'GET') {
      response.setHeader('Set-Cookie', `arti_session=${authentication.session}; HttpOnly; SameSite=Strict; Path=/`);

      return send(response, 200, JSON.stringify({ mode: 'simulation', authenticated: true }));
    }

    const actor = authentication.authenticate(request);

    if (!actor) return send(response, 401, JSON.stringify({ error: 'Authentication required' }));

    if (url.pathname === '/api/v1/local-glm/source' && request.method === 'GET') {
      if (actor.role !== 'operator' || !localGlm) return send(response, 403, JSON.stringify({ error: 'Local operator inference required' }));
      const project = service.getState().projects?.[0];

      if (!project) return send(response, 404, JSON.stringify({ error: 'Project unavailable' }));
      const repository = service.execution.repositories;
      const path = repository.path(project.repository);
      const commit = await repository.head(path);
      const source = await repository.read(path, commit, 'site/index.html');

      return send(response, 200, JSON.stringify({ commit, source }));
    }

    if (url.pathname === '/api/v1/local-glm/retry' && request.method === 'POST') {
      if (actor.role !== 'operator' || !localGlm) return send(response, 403, JSON.stringify({ error: 'Local operator inference required' }));
      await service.localMutation(engine => engine.localStatus('ready'));

      return send(response, 200, JSON.stringify({ status: 'ready' }));
    }

    if (url.pathname === '/mcp') return serveMcp(request, response, actor, service, tools, catalogue);

    if (url.pathname === '/api/v1/world' && request.method === 'GET') {
      if (actor.role !== 'operator') return send(response, 403, JSON.stringify({ error: 'Private operator view' }));

      return send(response, 200, JSON.stringify(service.getState()));
    }

    if (url.pathname === '/api/v1/catalog' && request.method === 'GET') return send(response, 200, JSON.stringify(actor.role === 'operator' ? catalogue : publicCatalogue(catalogue)));

    if (url.pathname === '/api/v1/commands' && request.method === 'POST') {
      const envelope = commandEnvelopeSchema.parse(JSON.parse(await body(request)));
      const state = await service.command(actor, envelope.command, envelope.idempotencyKey);

      return send(response, 200, JSON.stringify(actor.role === 'operator' ? state : service.getPublicState()));
    }

    return send(response, 404, JSON.stringify({ error: 'Route not found' }));
  }

  onCleanup(() => closeServer(api));
  await listen(api, ports.api);
  const sites: ReturnType<typeof createServer>[] = [];

  const siteEntities = service.getState().projects?.length ? [] : service.getState().entities;

  for (const [index, entity] of siteEntities.entries()) {
    const site = createServer((request, response) => { void (async () => {
      if (request.method !== 'GET') return send(response, 405, 'Read-only public website', 'text/plain');

      const page = await service.execution.site(entity.id);
      const publicState = service.getPublicState();

      if (request.url === '/api/activity') return send(response, 200, JSON.stringify({ entity: publicState.entities.find((item) => item.id === entity.id), discussions: publicState.discussions.filter((item) => item.entityId === entity.id), events: publicState.events.filter((item) => item.actorId === entity.id) }));

      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      const activity = publicState.discussions.filter((item) => item.entityId === entity.id).map((item) => `<article><p>${escapeHtml(item.body)}</p><small>${escapeHtml(item.createdAt)}</small></article>`).join('');
      const html = page.html.replace('</main>', `<section><h2>Public discussions</h2>${activity || '<p>No public discussions yet.</p>'}</section><p><a href="http://localhost:5173/world">Explore the world</a></p></main>`);

      send(response, 200, html, 'text/html');
    })().catch(() => send(response, 500, 'Website unavailable', 'text/plain')); });

    onCleanup(() => closeServer(site));
    await listen(site, ports.siteStart === 0 ? 0 : ports.siteStart + index);
    sites.push(site);
  }

  const knowledgeRoot = join(dataRoot, 'knowledge-public');
  await buildPublicKnowledge(root, knowledgeRoot);

  const knowledgeAssets = new Map([
    ['/', { file: 'index.html', type: 'text/html' }],
    ['/styles.css', { file: 'styles.css', type: 'text/css' }],
    ['/search.js', { file: 'search.js', type: 'text/javascript' }],
    ['/catalog.json', { file: 'catalog.json', type: 'application/json' }],
  ]);

  const knowledge = createServer((request, response) => { void (async () => {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) return send(response, 405, 'Read-only public knowledge', 'text/plain');
    const path = new URL(request.url ?? '/', 'http://localhost:4174').pathname;
    const project = service.getPublicState().projects?.[0];

    if (project && path === '/') {
      const page = await service.execution.site(project.id);
      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; sandbox; frame-ancestors http://localhost:5173 http://127.0.0.1:5173; form-action 'none'");

      return send(response, 200, request.method === 'HEAD' ? '' : page.html, 'text/html');
    }

    const asset = knowledgeAssets.get(path === '/knowledge' ? '/' : path);

    if (!asset) return send(response, 404, 'Not found', 'text/plain');
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    send(response, 200, request.method === 'HEAD' ? '' : await readFile(join(knowledgeRoot, asset.file), 'utf8'), asset.type);
  })().catch(() => send(response, 500, 'Knowledge unavailable', 'text/plain')); });

  onCleanup(() => closeServer(knowledge));
  await listen(knowledge, ports.knowledge);

  const localRunner = localGlm ? new LocalGlmRunner(service, cloudflareLocalModel(localGlm.accountId)) : undefined;
  let lastIdleTick = Date.now();

  const timer = autoTickMs > 0 ? setInterval(() => {
    if (localRunner) { void localRunner.step();

 return; }

    const state = service.getState();
    const active = state.goals.some((goal) => goal.status === 'active');
    const idleDue = Date.now() - lastIdleTick >= 6_000;

    if (!state.paused && (active || idleDue)) {
      lastIdleTick = Date.now();
      void service.command({ role: 'system' }, { type: 'world.tick' }, `auto-${randomUUID()}`).catch((error: Error) => console.error('Simulation paused by execution error:', error.message));
    }
  }, autoTickMs) : undefined;

  const address = z.object({ port: z.number().int().positive() }).parse(api.address());

  return {
    service,
    apiUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      clearInterval(timer);
      await localRunner?.close();
      await Promise.all([api, knowledge, ...sites].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
      tools.close();
      service.close();
    },
  };
}

async function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
