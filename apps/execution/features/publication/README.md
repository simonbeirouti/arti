# execution.publication

Workflow `workflow.entity-publication` turns a pinned repository revision into an immutable, verified public bundle. LocalExecution uses real independent Git repositories and task clones, compares canonical HEAD before promotion, serializes entity publication, escapes public content, stores content-addressed HTML, and checks its hash on read. Rollback selects a retained release; it does not reverse application data.

Simulation runs a fixed static renderer against a strict public-content schema. It does not execute arbitrary agent code on the operator machine and cannot establish cloud verification. Private agent instructions are present in repositories but are never read by the publication renderer. Goal context must pass the world's revision/status validator immediately before promotion.

## Developer guide

Run `pnpm test tests/integration/execution.test.ts`. Local data lives under the configured data directory in repositories/, workspaces/, bundles/, and deployments/. Git must be on PATH. Do not store this directory under a public web root. LocalExecution is intended for one server process; distributed live promotion requires authoritative world serialization and fencing.

## Cloud activation

Cloudflare adapters are separate from Node-only local modules. LiveGate requires explicit activation, a positive configured allowance, and an AllowanceAuthority backed by atomic world reservations. Unknown actual costs must stay conservatively reserved until reconciled; they must never be treated as free.

Artifacts uses the documented Workers binding and disposable handles. Agents get fifteen-minute write tokens to task forks, not canonical repositories. The trusted uploader accepts compiled modules, supplies an empty binding allowlist, and never executes build commands. Configure account-scoped deployment credentials only on that uploader. Dispatch removes operator authentication and cookie headers and strips Set-Cookie responses. Use a dedicated entity registrable domain separate from the Access-protected console.

The adapter layer does not claim a cloud-verified deployment. Staging requires real account access to Artifacts, dispatch namespaces, sandbox execution, R2 outputs, and event-triggered Workflow configuration. Isolated build and promotion orchestration must pass live tests before the platform enables autonomous cloud publication.

Cloudflare staging can disable all generated-code publication and serving with `PUBLICATION_ENABLED=false`; this is required while isolated entity hosting is unavailable. The platform map can still be served by its trusted public application. See the [execution activation guide](../cloud-build/README.md#staging-without-isolated-entity-hosting). The local simulation publisher is unaffected by this Cloudflare-only flag and its receipts remain simulated.

Canonical shared repository push events are promotion outputs, not new build requests. After publication/live gates, event-shape checks and exact registered namespace validation, the queue acknowledges an exact world-registered project repository (such as `collective`) without creating a workflow or reserving model/build allowance. Scoped task-fork push events retain their existing checked publication path; unknown repositories and prefix-only matches remain rejected. Focused Worker evidence: `canonical-push.worker.ts` and `gate.worker.ts`.
