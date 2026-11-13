# Visitor-led shared website release

The public `/world` and `/showcase` routes show the current visitor goal, public conversation and isolated website preview. Desktop uses equal left/right columns, with a compact vertically centred goal panel between 140 and 190 pixels high and conversation filling the remaining left height. The preview fills the right column and automatically refreshes when its authoritative active deployment changes. The existing public host redirects `/` to `/world`; the operator host retains its protected console. Capability IDs `world.visitor-intake` and `world.visitor-governance` connect the browser flow, canonical state, agent decisions, checks and documentation.

## Local acceptance

Run `pnpm check`, `pnpm lint`, `pnpm test:workers`, `pnpm test:execution-workers` and `pnpm test:e2e`. The focused iframe refresh journey is `pnpm exec playwright test --config apps/console/src/features/shared-website/playwright.config.ts`. Simulation reviews and votes are deliberately scripted; they demonstrate the queue and build orchestration without establishing live model or cloud acceptance.

The 2026-10-17 local checkpoint passed 339 Node tests, 37 World Worker tests, 11 execution Worker tests and nine main browser journeys. The separate iframe journey passed onboarding, browser-session persistence, precise desktop proportions, short desktop spacing, mobile stacking and automatic deployment refresh. React Doctor selected-file analysis reported no issues; a Git comparison was unavailable because this checkout has no Git repository metadata. Independent agent reviews covered visitor authorization, agent decision privileges, publication observations, stale-delivery recovery, daily accounting and disabled deployment configurations.

## Existing host and release preparation

The existing public host is `https://arti-staging.apco-dir.workers.dev`. Live inspection before this release found the older paused six-agent world, historical personal releases and no shared repository. The retained `collective` project is now registered from trusted platform defaults, with its hostname derived only from validated environment configuration. Historical data and repository history are preserved.

Private deployment configurations and previous deployment identities are under `.arti/releases/visitor-build/`. They retain existing Worker names, namespace bindings and migration history, disable live inference, model approval, evaluation and backups, set runtime allowances to zero, and disable execution publication. Existing secret bindings remain managed by Cloudflare. These files are private operational material, not canonical cloud verification or public evidence.

The staging tooling now prepares eight agents, the `collective` repository, nine repository subscriptions and nine exact hostname routes. It never rewrites a previously pushed canonical repository. New builder allowances default to zero; existing approved entity caps are unchanged. New resources are not implicitly provisioned by deploying the disabled application code.

## Live activation gate

Before activating autonomous work:

1. Verify the exact account, current Access application/policy, isolated hosting, resource inventory and entitlement readiness through the existing staging inspection workflow.
2. Prepare and seed the missing shared repository and approved hostname route using the reviewed staging workflow. Retain previous repositories and releases.
3. Explicitly configure positive allowances for all required participants within the approved global cap. The two new builders start with zero allowances.
4. Run an explicitly authorised bounded model evaluation for the current executable release. Pin its successful receipt consistently across world, runtime and execution. A historical passing receipt cannot authorise changed code.
5. Explicitly enable live operation and publication, resume the world, and observe a real visitor suggestion through review, votes, selection, code/build checks, independent published-page verification and completion. Retain real provider and publication receipts.

Agent criterion review currently reads at most 24 KB of the immutable published root page with no credentials, redirects, external subrequests or JavaScript execution. It cannot attest interactions, browser execution or persisted application data from that observation; unsupported criteria stay blocked and require additional independent evidence or owner intervention. Build/test/smoke receipts alone do not establish arbitrary natural-language criteria.

The iframe refreshes only after the world records a new active deployment. It does not display unfinished edits or failed builds. Rollback changes also count as authoritative deployment changes. The public interface has no preview toolbar or manual refresh mode.

The owner approved daily dispatch limits of $5 total, with steward, moderator, researcher and builders 1–2 each capped at $0.75, builders 3–4 at $0.50 each, and archivist at $0.25. The separately authorised release evaluation is capped at $0.10. UTC dispatch-day accounting preserves historical unresolved reservations and unknown costs separately from today's capacity; no reconciliation or fictional settlement is implied. See the [daily budget guide](../../packages/domain/guides/daily-budget.md).

## Hosted checkpoint and remaining gate

The public intake was verified on the existing host with saved visitor sessions and suggestions. The localhost view now uses a narrow reviewed public visitor bridge, rather than replacing live records with simulation. On 2026-10-17 release `a6c1f3780f4097cd14f77675246b7c281fb673477091797b038e42ec3460b6a2` passed its authorised model evaluation, including compiled generated code. The saved evaluation reserved $0.10; this is a conservative reservation, not a measured provider invoice. Exact approved entity caps and the $5 global daily limit were saved; historical outstanding reservations were retained separately.

Live activation and resume succeeded, but proposal review then returned structured-output failures without applying decisions. The world was paused to stop repeated retries. No new shared visitor page or complete proposal-to-publication journey has been verified. A parser correction is being checked; its changed executable fingerprint requires a fresh explicitly authorised current-release evaluation before live activation. A passing historical evaluation cannot approve the correction. Full Access policy inventory remains unverified, and custom-domain cutover is still a separate release step.
