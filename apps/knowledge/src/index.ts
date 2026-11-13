import { z } from 'zod';
import { visitorCookie, visitorCookieName, visitorPaths } from '../../world/features/visitor-http/http';

interface AssetService { fetch(request: Request): Promise<Response> }

interface Environment { ASSETS: AssetService; WORLD?: AssetService; PUBLIC_WORLD_HOME?: string }

const publicApi = new Set(['/api/v1/public', '/api/v1/public/world', '/api/v1/public/build', '/api/v1/public/analytics', '/api/v1/public/catalog', '/api/v1/public/config', '/api/v1/public/knowledge/search']);

async function previewSources(request: Request, world?: AssetService): Promise<string> {
  if (!world) return "'none'";

  try {
    const result = await world.fetch(new Request(new URL('/api/v1/public/world', request.url), { headers: { Accept: 'application/json' } }));
    const data = z.object({ projects: z.array(z.object({ hostname: z.string().optional() })) }).parse(await result.json());
    const hosts = data.projects.flatMap(project => project.hostname && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(project.hostname) ? [`https://${project.hostname}`] : []);

    return [...new Set(hosts)].join(' ') || "'none'";
  } catch { return "'none'"; }
}

export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/' && environment.PUBLIC_WORLD_HOME === 'true' && ['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 302, headers: { Location: '/world', 'Cache-Control': 'no-store' } });
    const visitorRoute = visitorPaths.has(url.pathname);
    const allowed = visitorRoute ? (url.pathname.endsWith('/session') ? ['GET', 'POST'] : ['POST']) : ['GET', 'HEAD'];

    if (!allowed.includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: allowed.join(', ') } });

    if (url.pathname.startsWith('/api/') && !publicApi.has(url.pathname) && !visitorRoute) return new Response('Not found', { status: 404 });

    const pageRoute = ['/world', '/showcase'].includes(url.pathname);
    const worldRoute = pageRoute || url.pathname.startsWith('/assets/') || publicApi.has(url.pathname) || visitorRoute;
    const headers = new Headers({ Accept: request.headers.get('Accept') ?? '*/*' });

    if (visitorRoute) {
      const token = visitorCookie(request);

      if (token) headers.set('Cookie', `${visitorCookieName(url)}=${token}`);

      for (const name of ['Origin', 'Sec-Fetch-Site', 'Content-Type', 'Content-Length']) {
        const value = request.headers.get(name);

        if (value) headers.set(name, value);
      }

      // Cloudflare overwrites this address on ingress; do not forward arbitrary proxy headers.
      if ('cf' in request && request.cf && request.headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', request.headers.get('CF-Connecting-IP')!);
    }

    // SAFETY: duplex is Node's Request streaming requirement; Cloudflare accepts this standard RequestInit extension.
    const upstream = worldRoute && environment.WORLD
      ? await environment.WORLD.fetch(new Request(request.url, { method: request.method, headers, body: request.method === 'POST' ? request.body : undefined, duplex: 'half' } as RequestInit))
      : await environment.ASSETS.fetch(request);

    const response = new Response(upstream.body, upstream);
    const frames = pageRoute ? await previewSources(request, environment.WORLD) : "'none'";
    response.headers.set('Content-Security-Policy', `default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src ${frames}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    const cookies = upstream.headers.getSetCookie();
    response.headers.delete('Set-Cookie');

    if (visitorRoute) for (const cookie of cookies) {
      if (cookie.startsWith(`${visitorCookieName(url)}=`) && /;\s*HttpOnly(?:;|$)/i.test(cookie) && /;\s*Path=\/(?:;|$)/i.test(cookie) && !/;\s*Domain=/i.test(cookie)) response.headers.append('Set-Cookie', cookie);
    }

    return response;
  },
};
