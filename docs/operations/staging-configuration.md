# Staging account configuration and release preparation

The staging CLI prepares a separate Cloudflare environment. It does not deploy Workers, enable inference, or accept completion. The example deliberately fails validation until account details are supplied. The prepared allowance is **$5/day globally**, with steward $1, moderator $0.75, each builder $1, researcher $1, archivist $0.25. These are requested caps. Generated configurations retain zero provider allowance, disabled live activity, disabled evaluations and disabled automatic simulation ticks. Apply the requested caps through authenticated operator controls only after the staging checks and explicit activation.

## Default Cloudflare URL staging

Copy `infrastructure/environments/staging.workers-dev.example.json` to your local staging configuration. Set `hosting` to `workers-dev` and `workersDevSubdomain` to the account's existing subdomain (for this deployment, `apco-dir`). With prefix `arti-staging`, configure `domains.operator.hostname` as `arti-staging-world.apco-dir.workers.dev` and `domains.knowledge.hostname` as `arti-staging.apco-dir.workers.dev`. Omit their zone IDs. Omit `domains.entities` for model-only staging, or configure independent entity hosting as described below. The public Worker keeps the existing `arti-staging` name. The CLI verifies the subdomain against the account API before provisioning resources.

The operator host still requires the exact Access application, audience and explicit operator-email policy described below. Default hosting never relaxes authentication. Only the operator and public knowledge Workers have `workers_dev` enabled; agent runtime, execution and outbound services remain internal, and all preview URLs remain disabled. Zone IDs, domain ownership and DNS changes are unnecessary for these two default hosts.

Agent-authored public websites remain disabled in default-hosted staging. `PUBLICATION_ENABLED` is false, the entity domain is empty, and execution receives no public routes. Sibling account Workers are not treated as independent untrusted-site isolation. To prepare agent websites while retaining both default trusted hosts, keep `hosting: "workers-dev"` and add `domains.entities: { "hostname": "agents.your-independent-domain.com", "zoneId": "<active-zone-id>" }` plus the account-owned digest-pinned `buildImage`. The CLI verifies this entity zone belongs to the account and contains the hostname, as well as checking the trusted account workers.dev subdomain. The Public Suffix List isolation rule still applies. Generation attaches six explicit Workers Custom Domains to execution, one for each stable entity ID (for example, `researcher.agents.your-independent-domain.com`). Cloudflare provisions DNS and certificates for each hostname, including nested hosts that are not covered by the zone's ordinary wildcard certificate. Execution workers.dev and preview URLs stay disabled. Review existing DNS ownership and any conflicting hostname records before deployment; each domain also has an exact-host `/*` Worker route to the same execution Worker, so pre-existing broader zone routes cannot intercept the generated sites. No arbitrary-host wildcard Worker route is generated; unrelated zone routes remain unchanged. This prepares hosting without enabling publication: `PUBLICATION_ENABLED` stays false in both world and execution until separately reviewed activation.

The pinned build image may be omitted in this limited mode. The generated execution configuration then has no container image or sandbox binding, so build execution remains unavailable. All inference, execution and evaluation allowance flags still default to disabled/zero. Full execution provisioning still needs the remaining account entitlements and trusted build image; this mode provides no substitute or simulated cloud evidence.

## Account details needed

Supply these non-secret values in a local copy of `infrastructure/environments/staging.example.json`:

- Cloudflare account ID (32 hexadecimal characters) and a unique environment prefix ending `-staging`.
- For custom-domain hosting (the default), active Cloudflare zone IDs for the operator, public knowledge and entity hostnames. All must belong to that account. Entity sites need a **different registrable domain** from both trusted operator and knowledge hosts; `console.example.co.uk` and `agents.example.co.uk` are insufficient. Public suffixes, including private hosting suffixes, are checked with the Public Suffix List through `tldts`.
- Existing Zero Trust team domain, self-hosted Access application UUID and audience tag for the exact operator hostname, plus allowed human email addresses. Configure an explicit email allow policy first. The inventory check rejects bypass/service policies, broad group/everyone selectors and audiences/domain mismatches. The application and identity provider are not created automatically.
- Approved research hostnames. No wildcard hosts or arbitrary research network access. Keep the initial list small.
- A tested build container image in the account registry, pinned by nonzero SHA-256 digest. Its trusted toolchain must include the build/runtime dependencies and Git. No floating `latest` tags.

Enable account access to Workers/SQLite Durable Objects, Agents, Workflows, Queues/event subscriptions, D1, R2, Workers AI, Artifacts, Containers and Workers for Platforms dispatch namespaces, plus Browser Run for browser research. Native Containers and Browser Run are used directly; the optional Sandbox and Puppeteer SDKs are not required. Verify entitlements and billing in the account before provisioning. Provider resource creation and subsequent visitor traffic can incur costs independently of agent dispatch allowances.

Supply **credentials separately**, never in this JSON, Git, screenshots or command arguments:

- `CLOUDFLARE_API_TOKEN` in the provisioning process environment, scoped to this account. Provisioning needs read/edit access for Artifacts, Queues/event subscriptions, D1, R2 and Workers for Platforms dispatch namespaces, plus read access to Access applications/policies/organization and active zones. Account permission labels can vary by entitlement; verify in the API token editor. Do not use a global API key.
- Worker deployment credentials are a separate operator action. The trusted execution Worker requires its `DEPLOY_TOKEN` secret with the minimum dispatch upload permissions. Agent-authored code and sandbox build processes must never receive it.
- Optional external entity MCP credentials are installed as server-side hashes through `ENTITY_MCP_TOKEN_HASHES`; callers do not supply actor identity. Do not configure this capability until its authenticated staging tests pass.

No domain purchase, DNS mutation, Access policy change, secret installation or live activation is performed by the provisioning CLI. Separately deploying generated Workers Custom Domains provisions their DNS and certificates. A pasted npm EACCES/cache error does not provide account identifiers. Use the pinned local Wrangler and fix/use a writable npm cache separately; a new global CLI is unnecessary.

## Commands and effects

Run from the repository root with the installed pnpm workspace. `doctor` is entirely local; it verifies Node >=22, installed Wrangler 4.x and Git 2.x. Last exercised here: Node 24.21.0, Wrangler 4.149.0, Git 2.54.0. The lockfile defines the dependency versions; the CLI never downloads a different cloud administration tool.

```sh
pnpm exec tsx tooling/staging/cli.ts doctor
pnpm exec tsx tooling/staging/cli.ts plan staging.local.json
pnpm exec tsx tooling/staging/cli.ts inspect staging.local.json
pnpm exec tsx tooling/staging/cli.ts apply staging.local.json --confirm arti-staging
pnpm exec tsx tooling/staging/cli.ts generate staging.local.json --inventory .arti/staging/arti-staging/inventory.json
```

`plan` validates configuration and prints intended names/resources without a token or network calls. `inspect` performs read-only provider discovery and fails on a missing resource or unsafe drift. `apply` requires the exact prefix confirmation, verifies Access and zone ownership before mutation, and discovers resources by stable names before creating missing resources. It does not delete or silently repair drift. Retry with the same configuration after an interruption: existing resources and nonempty repository history are retained. Keep provisioning serialized per prefix; concurrent provisioners are unsupported.

Resources are isolated by prefix: four application Workers and an outbound-deny Worker, one D1 projection database, two private R2 buckets, four queues, an Artifacts namespace, two dispatch namespaces, a publication Workflow, and durable-object namespaces owned by the generated Worker scripts. Queues, buckets, Artifacts/dispatch namespaces and D1 are provisioned by `apply`; Workers, Workflows and Durable Objects are created during the separately reviewed Worker deployment. Existing R2 buckets are checked for both r2.dev and custom-domain public access and rejected if exposed.

Six independent canonical repositories are initialized from the trusted `templates/entity` tree. A repository that has already received a push is never reseeded. Git uses a 15-minute repository-only token in process environment, not account credentials; no remote token is stored in `.git/config`, logs or arguments. Creation responses differ from repository metadata; auto-issued creation tokens are revoked before seeding. Issued seed tokens are revoked in cleanup. No force push is used. The template contains source/private instructions: the publication pipeline must still exclude private instruction files from bundles.

Each canonical repository receives an enabled `artifacts.repo` subscription for event `pushed`, delivering to the isolated artifact-events queue. These arrive as `cf.artifacts.repo.pushed` messages. Existing destination/source/event mismatches stop provisioning. Every dynamically created task fork also needs its own push subscription before it is handed to an agent; canonical subscriptions do not cover forks. The runtime repository gateway must ensure that subscription, or invoke the platform publication command explicitly. Never assume the account lifecycle `artifacts` source delivers repository push events.

`generate` uses the matching verified inventory to write five JSON Wrangler configurations under `.arti/staging/<prefix>/`: world, agent, execution, knowledge, outbound. It binds the isolated resource names, trusted origins, Access audience/emails and pinned image. It deliberately leaves `LIVE_ACTIVATED`, `MODEL_EVALUATED`, `EVALUATIONS_ENABLED`, `PUBLICATION_ENABLED`, `BACKUPS_ENABLED` and automatic simulation disabled, with zero daily and evaluation allowances. Requested quotas remain configuration records, not activation. Generated paths are machine-local absolute paths; regenerate on the deployment host. Inventory records are configuration evidence, **not successful cloud execution evidence**.

## Deployment handoff and remaining checks

1. Run `pnpm check`, `pnpm lint`, browser acceptance, Worker tests and bounded provider integration tests. Build the canonical public catalogue and both frontends. Review generated configuration and saved inventory against this account.
2. Deploy the outbound-deny Worker before dispatch use. Deploy the app Workers with the generated configurations; cross-service bindings may require deploying world/agent together as stub-free service versions. Apply the D1 migrations to the isolated database. Do not substitute the unnamespaced example Wrangler files.
3. Deploy and verify the six explicit entity Workers Custom Domains and their managed DNS/certificates, plus operator/knowledge custom domains when configured. Confirm Access protects the operator host and API and that neither Workers.dev nor preview URLs bypass Access. Confirm generated sites receive no operator cookies or private bindings.
4. Install secrets through the provider secret mechanism, never generated config. Verify authenticated REST/MCP, origin checks, per-entity data scoping, Artifacts push delivery, Workflow retries, browser host controls and sandbox isolation. Exercise rollback and private backup/restore using the release checklist.
5. Conduct a bounded real-model evaluation and save its immutable receipt under the generated environment identity `<prefix>:<accountId>`. Evaluation allowance is a subset of the same $5 global daily cap, not an additional spending pool. Configure the verified evaluation ID only after review. Simulated receipts cannot pass this gate.
6. Configure the $5 global and explicit entity caps, enable a bounded evaluation allowance when approved, then explicitly activate live operation. Run a real goal through task review, criterion verification and human acceptance. Record the provider evidence and costs. Resource readiness alone does not authorize publication or completion.

Generated world, agent and execution configurations set `durable_objects.code_update_strategy` to `{ "mode": "immediate" }`. The installed Wrangler schema accepts this strategy; deferred updates otherwise wait for hibernation, with a default maximum delay of five minutes. Immediate code updates retain the namespace and SQLite state, but may interrupt active work. Checkpoints, idempotent retries and compatible stored data remain required.

When releasing an already-uploaded version through `wrangler versions deploy`, use `--durable-objects-code-update-mode immediate` or the generated configuration containing that strategy. A deployment showing 100% HTTP traffic does not verify the Durable Object receiver's release. Read its authority fingerprint through the authenticated operator flow or private setup Workflow before model evaluation or activation. A fingerprint mismatch must fail closed. Do not rename, delete or recreate the class or namespace to refresh code.

## Sources and API verification

Checked against the installed Wrangler 4.149.0 implementation and Cloudflare documentation on 2026-10-12:

- [Artifacts REST API](https://developers.cloudflare.com/artifacts/api/rest-api/) and [REST setup/authentication](https://developers.cloudflare.com/artifacts/get-started/rest-api/) define namespace/repository/token control-plane calls and repository-scoped Git credentials.
- [Artifacts event subscriptions](https://developers.cloudflare.com/artifacts/guides/event-subscriptions/) distinguishes repository `pushed` events from account lifecycle events.
- [Queue event subscriptions](https://developers.cloudflare.com/queues/event-subscriptions/) describes queue destinations and subscription management.
- [R2 domain APIs](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/) expose managed/custom public access state.
- [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/) describes dispatch namespaces and generated Worker routing.
- [Wrangler Worker deployment commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/) documents `--durable-objects-code-update-mode immediate`; the installed `node_modules/wrangler/config-schema.json` defines `durable_objects.code_update_strategy` and the deferred delay default.

Keep these checks current when upgrading Wrangler or changing provider APIs. Failed provider responses intentionally omit response bodies, which can contain credentials.

Read-only routing checks: `pnpm staging:smoke staging.local.json`. The public game world is hosted at the knowledge hostname `/world`; its facade exposes only explicit public routes and strips credentials. Private operations and goal controls remain on the Access-protected operator host. Configure `BACKUP_ALLOWANCE_USD` explicitly as an additional maintenance subset; Git maintenance also reserves the global and entity allowance, and unknown costs survive restores. All generated maintenance limits remain zero.
