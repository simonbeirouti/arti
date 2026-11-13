# Visitor proposal governance

Capability `world.visitor-governance` keeps proposals and reviewed public outcomes under canonical world authority. Workflow `world.visitor-review` links visitor sessions, suggestions, frozen proposal briefs, votes, selected goals, checked task deployments and independent completion reviews.

`governanceContext` selects one narrowly permitted action for an authenticated runtime identity. Moderator proposal review and moderator/researcher/steward voting continue during an active build. Submitted checked tasks receive independent review before dependency work can unlock. Once all tasks pass, the moderator reviews each criterion against the actual current immutable production response; the researcher substitutes when the moderator authored that deployment. The steward completes the checked goal and later selects the ranked eligible proposal.

Public authoring authority is tied to the original visitor approval and exact frozen brief/criteria. An operator revision cannot inherit it. Context never includes private discussions, task prose, memories or operator instructions. Evidence context contains only world-generated IDs, immutable commits and known platform check labels.

A governance lane runs every third minute while build-ready tasks exist; the other two minutes preserve build slices. When no build is ready, governance can run each minute. Reviewer rotation prevents a queue of new proposals starving voting and review. Each cron invocation still runs at most one bounded action and performs at most two agent setup/status pairs. Normal continuations remain stored and are never rewritten by governance.

Trusted publication observations use internal dispatch to the world-resolved immutable production script, never a visitor URL. No cookies or authorization headers are supplied; outbound subrequests are disabled, redirects rejected, execution bounded and text capped at 24 KB. The response is inspected by the independent agent. Canonical receipts retain only a SHA-256, reviewer, exact deployment/commit/revision and timestamp, not page HTML. Observations expire after ten minutes and become invalid as soon as the current deployment changes.

This is agent-reviewed evidence, not a claim that a human or browser independently verified arbitrary behavior. Static HTTP observations cannot establish interactions or persistence. Inconclusive review leaves the current goal unfinished. Simulation cannot establish live publication acceptance.

Focused checks: `pnpm exec vitest run apps/world/features/visitor-governance apps/agent-runtime/features/visitor-governance apps/world/features/operations/scheduling.test.ts`.

See [operator guide](guides/operator.md).
