import { z } from 'zod';
import type { Suggestion } from '../../../../packages/contracts/src/visitor-build';

export interface VisitorSession { hash: string; visitorId: string; expires: number }

export interface VisitorGateway {
  session(hash: string): Promise<{ id: string; name: string } | null>;
  onboard(hash: string, name: string, ipHash: string): Promise<{ id: string; name: string }>;
  suggest(hash: string, text: string, key: string, ipHash: string): Promise<Suggestion>;
}

const nameSchema = z.object({ name: z.string().trim().min(1).max(60).regex(/^[^\p{Cc}\p{Cf}<>]+$/u) }).strict();

const suggestionSchema = z.object({ text: z.string().trim().min(10).max(2000), idempotencyKey: z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/) }).strict();

export const visitorPaths = new Set(['/api/v1/visitor/session', '/api/v1/visitor/suggestions']);

export const visitorCookieName = (url: URL): string => url.protocol === 'https:' ? '__Host-arti_visitor' : 'arti_visitor';

export function visitorCookie(request: Request): string | undefined {
  const name = visitorCookieName(new URL(request.url));
  const value = request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);

  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

export async function hashVisitorToken(token: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('');
}

function freshToken(): string { return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''); }

export async function handleVisitorRequest(request: Request, gateway: VisitorGateway, ip: string): Promise<Response> {
  const url = new URL(request.url);
  const sessionPath = url.pathname === '/api/v1/visitor/session';
  const json = (value: { error: string } | { visitor: { id: string; name: string } | null } | { suggestion: Suggestion }, status = 200, headers?: HeadersInit) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...Object.fromEntries(new Headers(headers)) } });

  if (!(sessionPath && request.method === 'GET') && request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: sessionPath ? 'GET, POST' : 'POST' });
  const token = visitorCookie(request);
  const hash = token ? await hashVisitorToken(token) : '';

  if (request.method === 'GET') return json({ visitor: hash ? await gateway.session(hash) : null });

  if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'Same-origin request required' }, 403);

  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ error: 'JSON required' }, 415);

  if (Number(request.headers.get('Content-Length') ?? 0) > 8192) return json({ error: 'Request too large' }, 413);

  try {
    const reader = request.body?.getReader();
    const parts: Uint8Array[] = [];
    let length = 0;

    if (reader) while (true) {
      const part = await reader.read();

      if (part.done) break;
      length += part.value.length;

      if (length > 8192) { await reader.cancel();

 return json({ error: 'Request too large' }, 413); }

      parts.push(part.value);
    }

    const bytes = new Uint8Array(length);
    let offset = 0;

    for (const part of parts) { bytes.set(part, offset); offset += part.length; }

    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const ipHash = await hashVisitorToken(`visitor-ip:${ip}`);

    if (sessionPath) {
      const { name } = nameSchema.parse(value);
      const sessionToken = token ?? freshToken();
      const visitor = await gateway.onboard(await hashVisitorToken(sessionToken), name, ipHash);
      const secure = url.protocol === 'https:' ? '; Secure' : '';

      return json({ visitor }, 200, { 'Set-Cookie': `${visitorCookieName(url)}=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}` });
    }

    const { text, idempotencyKey } = suggestionSchema.parse(value);

    if (!hash) return json({ error: 'Enter a public name first' }, 401);

    return json({ suggestion: await gateway.suggest(hash, text, idempotencyKey, ipHash) });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: 'Invalid request' }, 400);
    const message = error instanceof Error ? error.message : '';
    const status = /limit|queue|too many/i.test(message) ? 429 : /session|name first/i.test(message) ? 401 : /idempotency/i.test(message) ? 409 : 400;

    return json({ error: status === 429 ? 'Visitor intake limit reached; try later' : status === 401 ? 'Enter a public name first' : status === 409 ? 'Submission key already used' : 'Suggestion unavailable' }, status);
  }
}
