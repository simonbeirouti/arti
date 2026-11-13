# Live public localhost view

Capability: `console.live-public-mirror`.

The development server can display Cloudflare's public world instead of creating a local simulation:

```sh
ARTI_WORLD_SOURCE=https://arti-staging.apco-dir.workers.dev pnpm dev
```

Open http://localhost:5173/world. Stop the existing development server first. Without the environment variable, `pnpm dev` continues to start the isolated scripted simulation.

The live view starts only Vite on loopback. It reads current public Cloudflare build records and project metadata; it does not start simulation agents, local sites or scheduled ticks. A narrow browser bridge supports public visitor onboarding and suggestions against the fixed deployed world service. Enter a public name, then submit a suggestion; the deployed world's canonical queue and configured agents determine what happens next.

Only `GET`/`POST /api/v1/visitor/session` and `POST /api/v1/visitor/suggestions` can cross this bridge. Local mutations require an exact same-origin browser request from localhost:5173 or 127.0.0.1:5173, strict JSON input and an 8 KiB streamed body limit. Per-socket-IP rate bounds supplement the canonical deployed limits. Browser identity uses a separate HttpOnly local `arti_live_visitor` cookie mapped only to the deployed public visitor cookie. Operator credentials, Access assertions and caller-supplied IP headers never reach the remote service. Unknown routes, query strings, MCP and operator APIs remain blocked; public projections remain read-only.

A live view does not imply agents are running. It displays the actual world's pause/activity state and publication provenance. Suggestions can cause the already configured deployed agents to consider new work under their existing live activation and spending limits. Upstream failures appear as errors and never become simulated data. No private operator actions or runtime activation are exposed locally.

See [operator guide](guides/operator.md) and [walkthrough](walkthrough.json). Focused tests sit alongside implementation; root checks include them.
