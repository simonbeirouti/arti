import type { Plugin } from 'vite';
import type { IncomingMessage } from 'node:http';
import { visitorBridge, visitorBridgePaths, APPROVED_WORLD_SOURCE } from './visitor-bridge.ts';

export { APPROVED_WORLD_SOURCE } from './visitor-bridge.ts';

export const LIVE_VIEW_CAPABILITY = 'console.live-public-mirror';

export function validateWorldSource(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parsed = new URL(value);

  if (parsed.origin !== APPROVED_WORLD_SOURCE || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(`ARTI_WORLD_SOURCE must be ${APPROVED_WORLD_SOURCE}`);
  }

  return APPROVED_WORLD_SOURCE;
}

const publicRoutes = {
  '/api/v1/public': '/api/v1/public/world',
  '/api/v1/public/world': '/api/v1/public/world',
  '/api/v1/public/build': '/api/v1/public/build',
  '/api/v1/public/config': '/api/v1/public/config',
};

/** Public reads stay credential-free; only exact visitor paths use the scoped browser bridge. */
export async function liveViewResponse(request: Request, source: string, fetchPublic: typeof fetch = fetch, trustedIp = 'local'): Promise<Response | null> {
  validateWorldSource(source);
  const url = new URL(request.url);

  if (url.pathname === '/' && request.method === 'GET') {
    return new Response(null, { status: 302, headers: { location: '/world' } });
  }

  if (!url.pathname.startsWith('/api') && url.pathname !== '/mcp' && !url.pathname.startsWith('/mcp/')) return null;

  if (visitorBridgePaths.has(url.pathname)) return visitorBridge(request, source, fetchPublic, trustedIp);

  if (request.method !== 'GET' || url.search) return Response.json({ error: 'This local view is read-only and public-only.' }, { status: 403 });

  if (url.pathname === '/api/v1/health') {
    return Response.json({ status: 'ok', mode: 'live-public-mirror', readOnly: false, visitorIntake: true, source });
  }

  const remotePath = Object.entries(publicRoutes).find(([path]) => path === url.pathname)?.[1];

  if (!remotePath) return Response.json({ error: 'This local view is read-only and public-only.' }, { status: 403 });

  try {
    const upstream = await fetchPublic(`${source}${remotePath}`, {
      method: 'GET', headers: { accept: 'application/json' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) throw new Error('Public world unavailable');
    const reader = upstream.body?.getReader();

    if (!reader) throw new Error('Public world returned no data');
    const chunks: Uint8Array[] = [];
    let size = 0;

    while (true) {
      const item = await reader.read();

      if (item.done) break;
      size += item.value.byteLength;

      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Public world response too large');
      }

      chunks.push(item.value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const result: unknown = JSON.parse(new TextDecoder().decode(bytes));

    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Cloudflare public world is unavailable. No simulated data was substituted.' }, { status: 502 });
  }
}

/** Bound incoming buffering even when origin checks reject before reading the body. */
function boundedVisitorBody(incoming: IncomingMessage): ReadableStream<Uint8Array> {
  let detach = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let size = 0;
      const end = () => { detach(); controller.close(); };

      const error = () => { detach(); controller.error(new Error('Visitor request interrupted')); };

      const data = (chunk: Buffer) => {
        size += chunk.length;

        if (size > 8192) { detach(); incoming.resume(); controller.error(new Error('Request too large'));

 return; }

        controller.enqueue(chunk);
      };

      detach = () => { incoming.removeListener('data', data); incoming.removeListener('end', end); incoming.removeListener('error', error); incoming.removeListener('timeout', error); incoming.setTimeout(0); };

      incoming.on('data', data); incoming.once('end', end); incoming.once('error', error);
      incoming.setTimeout(10000, error);
    },
    cancel() { detach(); incoming.resume(); },
  });
}

export function liveViewPlugin(source: string): Plugin {
  validateWorldSource(source);

  return {
    name: LIVE_VIEW_CAPABILITY,
    configureServer(server) {
      server.middlewares.use((incoming, outgoing, next) => {
        const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost:5173'}`);
        const method = incoming.method ?? 'GET';
        const headers = new Headers();

        if (visitorBridgePaths.has(url.pathname)) for (const name of ['origin', 'sec-fetch-site', 'cookie', 'content-type', 'content-length']) {
          const value = incoming.headers[name];

          if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }

        const init: RequestInit & { duplex: 'half' } = { method, headers, duplex: 'half' };

        if (visitorBridgePaths.has(url.pathname) && method === 'POST') init.body = boundedVisitorBody(incoming);
        const request = new Request(url, init);
        void liveViewResponse(request, source, fetch, incoming.socket.remoteAddress ?? 'local').then(async response => {
          if (!response) {
            next();

            return;
          }

          outgoing.statusCode = response.status;
          response.headers.forEach((value, name) => outgoing.setHeader(name, value));
          outgoing.end(Buffer.from(await response.arrayBuffer()));
        }).catch(next);
      });
    },
  };
}
