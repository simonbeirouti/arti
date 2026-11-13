# Cloudflare staging setup

No Cloudflare account or domain has been provisioned. All live defaults are false and daily paid allowance is zero. Wrangler configurations bundle the implemented services; placeholders intentionally prevent accidental production deployment.

Start with the [isolated staging configuration workflow](staging-configuration.md), including the exact account information needed and generated configurations. Use the pinned Wrangler version. The checked-in configurations are illustrative, not deployment targets. Review `apps/world/wrangler.jsonc`, `apps/agent-runtime/wrangler.jsonc` and `apps/execution/wrangler.jsonc` with the account administrator before creating resources. See [Artifacts CI](https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/) and [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/) for current provider configuration.

Required inventory:

| Resource | Purpose |
| --- | --- |
| Artifacts namespace and six canonical repositories | Independent versioned agent code |
| WorldDurableObject and EntityAgent namespaces | Canonical world and private per-entity state |
| Projection queue and D1 database | Rebuildable public index |
| Artifact event queue, dead-letter queue, PublicationWorkflow | Push-triggered checked deployment |
| Native build Container with immutable registry digest | Offline compiler/tests and trusted Git transport |
| Private R2 builds/evidence and backup buckets | Immutable bundles and recovery |
| Staging and production dispatch namespaces | Generated entity Workers |
| Workers AI binding | Bounded evaluated model inference |
| Operator Access application | JWT identity and explicit email allowlist |
| Operator, public knowledge and separate untrusted entity domains | Browser authority isolation |

Apply `infrastructure/migrations/0001_public_index.sql` to the configured D1 database. Configure queue producers/consumers, cron triggers and cross-script Durable Object/service bindings. Build `apps/execution/Dockerfile`, push the image to the account registry and replace the zero account/digest. Validate the image has no provider secrets and that build execution disables Internet access.

Set the execution Worker `DEPLOY_TOKEN` with `wrangler secret put`, scoped only to required dispatch operations. Use bindings for Artifacts access; repository tokens are short-lived and revoked after trusted transport. No deployment credentials enter agent repositories or build commands. Configure Access team domain, application audience, allowed operator email(s), operator origin and entity domain using `ACCESS_TEAM_DOMAIN`, `ACCESS_AUDIENCE`, `OPERATOR_EMAILS`, `OPERATOR_ORIGIN` and `ENTITY_DOMAIN` in the world/execution Workers. Use different registrable domains for operator and generated websites.

Build console assets with `pnpm build` before bundling the world Worker. Run `wrangler deploy --dry-run --config <service-config>` for each service. Deploy dependencies and validate bindings in a dedicated staging account/environment before enabling model calls. The operator activation endpoint requires an authenticated acknowledgement `ENABLE_LIVE_WORLD`, evaluated model configuration and positive allowance; an open simulation goal blocks activation. Before activation, configure each entity’s `budget.entity.configure` daily cap; a positive global allowance never grants entity allowance automatically. Starting live mode does not convert simulated evidence to real evidence.

Generated Workers receive a scoped application-data RPC capability through trusted dispatch props, never a raw namespace or private platform binding. Scheduled jobs use platform-validated manifests; both dispatch namespaces enforce a deny-all outbound Worker. Deploy that Worker first. Do not broaden trusted capabilities from an agent-authored manifest.

Cloud backup controls: configure private `WORLD_BACKUPS` and `WORLD_BUILDS`, matching environment fingerprints, `BACKUPS_ENABLED=true` on world/execution, and a positive `BACKUP_ALLOWANCE_USD` subset within world/entity caps. Authenticated operators list backups at `GET /api/v1/backups` and restore through `POST /api/v1/backups/restore` with acknowledgement `RESTORE_WORLD_BACKUP`; the world must be paused and stays paused. Complete v2 manifests restore world records, private entity memories, Git and application records/job claims behind a paused barrier. Restore retains current paid reservations and operator caps. Uploaded provider Workers must be retained independently; their deletion is not repaired by restoring the ledger.

For read-only research, configure exact comma-separated `RESEARCH_ALLOWED_HOSTS`; the empty default grants no hosts. Sources are returned with URL/time provenance and marked untrusted. Browser Run capture is implemented with private PNG/provenance storage, JavaScript disabled and exact-host request restrictions. Its real provider behavior remains an account acceptance gate.
