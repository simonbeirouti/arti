# execution.cloud-build

Live cloud execution uses the current native Workers Container API. Each job receives a fresh offline Linux container with preinstalled TypeScript. The platform reads only pinned `site/worker.ts` and `tests/worker.test.mjs` from Artifacts and sends their text over stdin. No repository token, account token, deployment token, world binding or provider credentials reach the container. Source is compiled, agent tests run, and a separate HTTP smoke check executes the compiled Worker. This first cloud build format supports a self-contained TypeScript Worker without third-party imports; richer dependency projects require an additional trusted dependency preparation stage.

The publication Workflow reserves budget through the authoritative world service, holds a per-entity publication lease, saves immutable bundles and private evidence in R2, uploads to staging, runs a dispatched HTTP smoke check, checks goal freshness and canonical deployment history, then uploads production modules to an immutable entity/bundle-hash script name and records the deployment. Public dispatch resolves only the current ledger-approved workerName, so an upload whose final authorization fails stays unreachable. Modules receive no bindings. A paused or revised goal cannot pass publication authorization.

## Activation prerequisites

Configure Artifacts account access, namespace `arti`, staging and production Workers for Platforms namespaces, R2 bucket, publication queue and dead-letter queue, a built/pushed Docker image from apps/execution/Dockerfile with its managed-registry digest replacing the zero placeholder in wrangler.jsonc, and a scoped `DEPLOY_TOKEN` Worker secret. Register an Artifacts `cf.artifacts.repo.pushed` event subscription targeting `arti-artifact-events` for the selected namespace. Only canonical entity names or registered task-fork names are accepted. The queue normalizes provider push events into the platform-owned Workflow request. Do not expose a public build-trigger endpoint.

Default activation is false and daily allowance is zero. Configure the world's live mode and allowance alongside execution settings before any live experiment. Provider accounts/domains and Docker cloud execution have not been verified by simulation tests. The workflow fences against world deployment state and promotes checked task-fork commits through a fresh trusted Git transport container using compare-and-swap main updates. That transport checks ancestry, never checks out or executes source code, and revokes its short-lived read/write tokens afterwards. Build containers remain separate and offline.

## Failure and recovery

Compilation/test/smoke failures prevent publication. Immutable R2 bundle keys preserve outputs. Duplicate push events use a deterministic Workflow ID. Build retries get fresh containers. Recognized runner compilation, test and smoke failures stop immediately without retrying the same source; unclassified execution/transport failures retain bounded retries. Failed process stdout/stderr is bounded to 32,768 characters per stream and saved under immutable private `private-build-failures/<workflow>/<capture>.json` keys with pinned source revision and environment. Captures are untrusted operational material, never public evidence or model instructions. Existing owned task-fork receipts expose only an exact-head `lastBuildFailure` category/commit marker; raw diagnostics remain operator-private. Earlier releases discarded failed process output and cannot retrospectively recover those diagnostics. Publication leases expire conservatively; an expired lease must block upload and completion. Cloud service upload and SQL authority are separate systems. A production script becomes active only through the world deployment ledger; an orphan upload stays inactive. Reconcile orphan scripts and retained bundles by their commit and bundle hash without changing the active route.

## References

- [Native Linux execution and Container API](https://developers.cloudflare.com/sandbox/get-started/)
- [Artifacts binding methods](https://developers.cloudflare.com/artifacts/api/workers-binding/)
- [Artifacts push event schema](https://developers.cloudflare.com/artifacts/guides/event-subscriptions/)
- [Workers for Platforms dispatch](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/)

Configuration was bundled with Wrangler 4.149.0 and binding compatibility is checked against the installed Workers types. A dry run verifies configuration and compilation, not account provisioning or cloud execution.

## Read-only research

The internal gateway exposes `research.retrieve` with `{ url, taskId? }`. It requires an assigned current task while a shared goal is active; personal research is permitted between active goals. Configure exact approved DNS names in comma-separated `RESEARCH_ALLOWED_HOSTS`; the default is empty and permits no destinations. Retrieval requires HTTPS, rejects credentials/ports and redirects, bounds response size and duration, reserves live allowance, and returns URL/time provenance marked `untrusted`. Retrieved instructions never acquire platform authority.

Personal code projects use stable `personal-<id>` task identifiers and independent entity-scoped forks. They may fork, read, patch, commit, and request builds only when all shared goals are closed. Starting a shared goal during a personal build prevents final publication. Task code operations additionally require completed dependencies. Live script names contain the full compiled bundle hash and a bounded entity prefix; dispatch activates them only from ledger receipts.

## Application data, scheduled code and recovery

Publication also reads the strict `site/services.json` manifest from the pinned source revision and saves it privately with the deployment ID. Job routing uses the active ledger version. The dispatcher supplies a per-entity application-data RPC capability, without granting direct access to private agent or world storage. See [generated application services](../application-services/README.md).

Trusted `ExecutionGateway.rollback(entityId,deploymentId)` reads a retained immutable bundle, verifies its SHA-256, validates public text, uploads the exact immutable worker name, and calls the world's rollback authorization and completion handlers under the entity publication lease. The authoritative ledger activation is the only routing switch. A concurrent pause or failed completion leaves the prior deployment active. The original job manifest is copied to the new rollback receipt. This restores code only; application records do not roll back with code.

Private backup exports use a fresh transport container, short-lived read token and Git bundle of all refs. The bounded RPC export supports repositories up to 600 KB compressed; larger repositories fail explicitly and need a streaming export implementation before release at that scale. Restores require a world-issued paused maintenance permit tied to a previously verified backup manifest, verify R2 checksum and Git bundle validity, then CAS-restore main and its complete history using a short-lived write token. Other refs remain in the retained bundle for explicit recovery. No generated code runs during export or restore.

Pre-live `evaluateCode` uses a separate explicit `EVALUATIONS_ENABLED` flag and one-shot world evaluation authorization. It compiles and tests offline without publication, Git promotion or agent activation. Generated code and authored tests execute in the isolated Node sandbox; their logs alone do not prove adversarial test integrity. Independent staging HTTP checks and operator review remain publication requirements.

## Staging without isolated entity hosting

Set `PUBLICATION_ENABLED=false` when staging uses default `workers.dev` addresses without an isolated entity domain. This closes the generated-code HTTP dispatcher, scheduled jobs, artifact event consumer (including dead letters), publication Workflow, build requests, and rollback before side effects or budget reservations. Invalid flag values also fail closed. An omitted flag preserves existing isolated-domain configurations; enable explicitly with `true` only after isolated hosting and publication prerequisites are verified.

Research, scoped application data, and task-fork editing retain their independent live activation, allowance, and binding requirements. They do not bypass the publication restriction. The one-shot model coding evaluation remains separately controlled by `EVALUATIONS_ENABLED` and world authorization: it can upload ephemeral code to the private staging dispatch namespace and clean it up, without publishing an agent site or promoting canonical code. Existing world ledger deployments remain inspectable while serving and scheduling are disabled.

## Approved public authoring scope

Live shared-goal code authoring requires an operator-approved public brief on the exact current goal revision. The isolated public writer runtime supplies a fourth RPC argument `{goalId,revision,taskId,approvalId}`; model tool arguments cannot select or modify it. Execution verifies the entity's own ready task, dependencies, active goal and approval ID against authoritative state before any public mutation or external research. Application data get/put/delete tools are disabled during every unfinished shared goal and for any scoped public writer. Shared-goal data changes must go through checked compiled services until revision-staged data writes are implemented. Private planning sessions may inspect other permitted records, but their tools do not grant publication or outbound research.

Build requests retain this scope. Artifact push events derive it from current world records, never from event payload identity. The pipeline revalidates before paid provider steps, staging upload, canonical promotion, production upload and ledger activation. Direction revisions and replacement approvals invalidate stale scopes. Immutable uploaded scripts remain unreachable until the world accepts their deployment receipt. Trusted starter repositories and personal projects can build without shared-goal scope only while no unfinished goal exists. Simulation retains its deterministic, explicitly labelled fixtures.
