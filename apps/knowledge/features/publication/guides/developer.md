# Build the public knowledge site

Guide ID: `knowledge.publication.developer`. Audience: developer.

1. Register a canonical guide once in `catalog/guides.json`, with its audience and stable workflow references.
2. Run `pnpm catalog:check` and `pnpm --filter @arti/knowledge build`.
3. Inspect the generated HTML and `catalog.json` under `apps/knowledge/dist`.
4. Confirm operator/agent-only guide bodies are absent and public definitions remain labelled.
5. Preview or deploy with the knowledge Worker's Wrangler configuration when authorized.

The search index derives solely from public guide titles and bodies. Public rendering never queries the private world service.

The public Worker forwards only explicit public API routes and map assets to the world service, removing caller credentials and response cookies. In workers.dev staging, `PUBLIC_WORLD_HOME=true` redirects the root URL to `/world`. Private operator endpoints remain unavailable through this facade. Entity website links remain unavailable on cloud hosts until an isolated entity domain is configured; localhost links are local-development only.
