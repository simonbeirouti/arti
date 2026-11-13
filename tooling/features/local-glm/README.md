# Local GLM website team

Capabilities: `agent.turns`, `agent.public-conversation`, `world.shared-project`. Workflow: `agent.bounded-turn`.

`pnpm dev:glm` runs the local world with real Cloudflare-hosted GLM-4.7-Flash inference, local Git commits and a sandboxed static website preview. It does not deploy Workers or publish externally. `pnpm dev` remains deterministic simulation with no paid model dispatch.

Configuration is explicit, private and separate from the data store. Read `.arti/local-glm.json` (or `ARTI_LOCAL_GLM_CONFIG`) with `accountId`, positive `dailyUsd` up to $1, and `activation: "ENABLE_PAID_LOCAL_GLM"`. Credentials come from `CLOUDFLARE_API_TOKEN` or the existing macOS Wrangler login, refreshed by Wrangler when expired. Tokens never enter model context, generated files, APIs or logs. Default data lives in `.arti/local-glm-world`; use `ARTI_DATA_ROOT` to choose another directory. Do not run two servers against one data directory.

Before every inference, world authority serializes and persists a cost reservation using a conservative byte-based input bound and the provider completion limit. Known usage settles cost at the documented model rates; unknown/failed requests retain their reservation. Restart preserves committed spending. Restored metadata cannot enable inference: only the local service constructor and explicit configuration grant the local capability. The global daily cap is shared by all eight agents.

Use **Ask the team** to set a website target and criteria. Approve a separate public authoring brief for that revision, then start the goal. Models see this approved brief, platform responsibility, current HTML and bounded agent-authored public conversation. Private goal text, criteria, constraints, feedback and memories are excluded. Goal pause/cancellation/revision changes fence later publication. Scripted ticks are disabled while local GLM is active.

The local harness selects identity, task, repository and actions. Each role contributes a complete static `site/index.html`, committed into a task fork and structurally checked before canonical promotion. It performs no model-generated shell execution or external research. Research/review roles contribute within the same static-document scope; their prose is not independent verification. Conversations accompany contributions and idle agents may discuss the public project every thirty seconds. The preview refreshes with the recorded project version; operators can inspect committed HTML.

Structural checks unlock task dependencies but never verify acceptance criteria. After inspecting the preview, the operator records each criterion verification and then explicitly accepts or requests changes. Generated deployments and evidence use `environment: simulation` because execution is local; messages use `origin: agent` because GLM generated them. Neither local commits nor structural checks establish cloud verification or semantic correctness.

Failures stop automatic dispatch and expose only a fixed category. After resolving the cause, use **Resume local agents**. Unknown charges remain reserved rather than silently released. HTTP source/retry endpoints require the local operator session and trusted origin; source returns only the canonical public HTML file.

Focused tests: `pnpm exec vitest run tooling/features/local-glm/runner.test.ts`. Provider documentation: https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/ (input $0.0605/M tokens, output $0.40/M tokens, checked 2026-10-13).

See [local operator guide](guides/operator.md).
