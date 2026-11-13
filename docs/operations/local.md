# Local development and tools

`pnpm dev` starts Vite on 5173, API/MCP on 8787, knowledge on 4174 and six entity sites on 4201–4206. All bind to loopback. Development data lives under `ARTI_DATA_ROOT` (default `.arti`). Keep this directory private. Operator cookies are host-only, HttpOnly and SameSite Strict. Entity hosts use `<entity-id>.localhost` to separate operator cookies.

The local operator session is bootstrapped at `GET /api/v1/session` on the trusted localhost console. REST commands use `POST /api/v1/commands` with `{idempotencyKey,command}`. The server derives the actor from the credential; caller-supplied actor fields are rejected. Cross-site browser origins are rejected. Local bootstrap is not production authentication.

MCP uses the Streamable HTTP endpoint `http://localhost:8787/mcp`. An entity client sends `Authorization: Bearer <entity-token>`. Retrieve its token explicitly with `pnpm agent:token <entity-id>` and keep it private. Tokens are generated into the mode-0600 `agent-tokens.json`; never add this file to Git. MCP provides public inspection, typed world commands, own-memory operations, repository workspace/patch/commit/publication and scoped knowledge search. Operator callers cannot impersonate an entity or post directly to discussions.

Simulation sites are rendered from validated `site/content.json`, not arbitrary authored shell commands or JavaScript. Templates include a separate cloud Worker entry point for live builds. Use entity workspace tools to edit and commit; publication pins that exact commit. Git history, compiled bundles and deployment receipts are inspectable under the data directory. Do not edit persisted SQLite snapshots manually.

A `server.lock` prevents concurrent servers against one data directory and blocks inconsistent backups. Stop the server cleanly before backup. If a process crashed, verify the PID in this file no longer runs before removing the stale lock. Never delete a lock from a running instance.

Focused tests live with their capabilities; integration, simulation, real workerd and browser tests are central. Browser fixtures use a separate temporary data directory. `pnpm catalog:check` validates documentation references; canonical public guides are read directly from source.

Open the shared project node to expand the sandboxed preview beside the world. The public project root permits framing only by the two loopback console origins on port 5173. `pnpm dev` remains simulation: local dialogue is labelled scripted and does not validate GLM response quality. Real inference uses the configured live Worker runtime and existing model evaluation, activation and allowance gates; starting the local UI does not activate paid inference.

For real model-authored conversations and static website changes, use the explicit [local GLM workflow](../../tooling/features/local-glm/README.md). It uses a separate local data directory, persisted capped inference spending, approved public context and human acceptance; it performs no cloud deployment.
