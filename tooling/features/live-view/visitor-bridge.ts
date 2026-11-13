import { z } from 'zod';
import { suggestionSchema, visitorSchema } from '../../../packages/contracts/src/visitor-build.ts';

export const APPROVED_WORLD_SOURCE = 'https://arti-staging.apco-dir.workers.dev';

const localCookie = 'arti_live_visitor';

const remoteCookie = '__Host-arti_visitor';

const localOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

const nameRequest = z.object({ name: z.string().trim().min(1).max(60).regex(/^[^\p{Cc}\p{Cf}<>]+$/u) }).strict();

const suggestionRequest = z.object({ text: z.string().trim().min(10).max(2000), idempotencyKey: z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/) }).strict();

const sessionResponse = z.object({ visitor: visitorSchema.nullable() }).strict();

const suggestionResponse = z.object({ suggestion: suggestionSchema }).strict();

const errorResponse = z.object({ error: z.string().max(200) }).strict();

const intake = new Map<string, number[]>();

export const visitorBridgePaths = new Set(['/api/v1/visitor/session', '/api/v1/visitor/suggestions']);

function json(error: string, status: number): Response { return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } }); }

async function boundedText(request: Request | Response, maximum: number): Promise<string> {
  const reader = request.body?.getReader();

  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) break;
      length += chunk.value.length;

      if (length > maximum) throw new Error('Request too large');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }

  const output = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }

  return new TextDecoder().decode(output);
}

/** Exact local browser mutations become exact public visitor requests; operator credentials never cross. */
export async function visitorBridge(request: Request, source: string, fetchPublic: typeof fetch, trustedIp = 'local'): Promise<Response> {
  if (source !== APPROVED_WORLD_SOURCE) return json('Visitor source is not approved', 403);
  const url = new URL(request.url);
  const session = url.pathname === '/api/v1/visitor/session';
  const allowed = session ? ['GET', 'POST'] : ['POST'];

  if (!visitorBridgePaths.has(url.pathname) || url.search || !localOrigins.has(url.origin)) return json('Local visitor endpoint unavailable', 403);

  if (!allowed.includes(request.method)) return json('Method not allowed', 405);
  const headers = new Headers({ Accept: 'application/json' });
  const cookie = request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${localCookie}=`))?.slice(localCookie.length + 1);

  if (cookie && /^[a-f0-9]{64}$/.test(cookie)) headers.set('Cookie', `${remoteCookie}=${cookie}`);
  let body: string | undefined;

  if (request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json('Same-origin local request required', 403);

    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json('JSON required', 415);

    if (Number(request.headers.get('Content-Length') ?? 0) > 8192) return json('Request too large', 413);

    try {
      const text = await boundedText(request, 8192);
      body = JSON.stringify((session ? nameRequest : suggestionRequest).parse(JSON.parse(text)));
    } catch (error) { return json(error instanceof Error && error.message === 'Request too large' ? 'Request too large' : 'Invalid visitor request', error instanceof Error && error.message === 'Request too large' ? 413 : 400); }

    const now = Date.now();
    const key = `${trustedIp.slice(0, 100)}:${session ? 'session' : 'suggestion'}`;

    for (const [entry, times] of intake) if (!times.some(time => time > now - 86400000)) intake.delete(entry);
    const times = (intake.get(key) ?? []).filter(time => time > now - 86400000);

    if (intake.size >= 1000 && !intake.has(key) || times.filter(time => time > now - 600000).length >= (session ? 10 : 3) || !session && times.length >= 20) return json('Visitor intake limit reached; try later', 429);
    intake.set(key, [...times, now]);
    headers.set('Origin', source);
    headers.set('Sec-Fetch-Site', 'same-origin');
    headers.set('Content-Type', 'application/json');
  }

  try {
    const upstream = await fetchPublic(`${source}${url.pathname}`, { method: request.method, headers, body, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10_000) });
    const value: unknown = JSON.parse(await boundedText(upstream, 65536));
    const result = upstream.ok ? (session ? sessionResponse : suggestionResponse).parse(value) : errorResponse.parse(value);
    const response = Response.json(result, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });

    if (session && upstream.ok) for (const header of upstream.headers.getSetCookie()) {
      const token = new RegExp(`^${remoteCookie}=([a-f0-9]{64});`).exec(header)?.[1];

      if (token && /;\s*HttpOnly(?:;|$)/i.test(header) && /;\s*Secure(?:;|$)/i.test(header) && /;\s*Path=\/(?:;|$)/i.test(header) && /;\s*SameSite=Lax(?:;|$)/i.test(header) && !/;\s*Domain=/i.test(header)) response.headers.append('Set-Cookie', `${localCookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
    }

    return response;
  } catch { return json('Cloudflare visitor service unavailable. No simulated data was substituted.', 502); }
}
