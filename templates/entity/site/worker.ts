interface AppData {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

interface PlatformContext { props: { APP_DATA?: AppData; job?: { id: string; scheduledAt: number } } }

export default {
  async fetch(request: Request, _env?: never, ctx?: PlatformContext): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === '/_arti/jobs/refresh') {
      if (!ctx?.props.job || !ctx.props.APP_DATA) return new Response('Trusted scheduled invocation required', { status: 403 });
      await ctx.props.APP_DATA.put('last-refresh', String(ctx.props.job.scheduledAt));

      return Response.json({ saved: true });
    }

    if (path === '/api/status' && ctx?.props.APP_DATA) return Response.json({ lastRefresh: await ctx.props.APP_DATA.get('last-refresh') });

    return new Response('<!doctype html><html lang="en"><title>Arti entity</title><main><h1>My public presence</h1><p>This entity is growing within Arti.</p></main></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};
