# Fresh shared website

Workflow `world.visitor-first-presence` connects the existing `world.visitor-intake` and `execution.publication` capabilities.

An account-authenticated owner Workflow acknowledges `RESET_SHARED_WEBSITE` with its immutable reset UUID. World authority requires a paused world, drained entity turns and no active publication, backup or restore lease. It saves the complete canonical snapshot under a private R2 reset key and verifies its SHA-256 before clearing public visitor proposals, votes, reviews, frozen public visitor goals and their work, public discussion/events and collective deployment projections. Names/sessions, private and operator-revised goals, agent memories, spending reservations, measured costs, model evaluations and Git/bundle history remain intact.

A durable reset barrier blocks new intake, unpause, unrelated work, backups and restores until preparation finishes. Replaying the same reset UUID returns its saved receipt without clearing again. Each agent's obsolete continuation and pending deliveries are separately archived and hash-verified in private R2 before clearing only operational state. World confirmation processes one entity per RPC, proves memory entries and turn count unchanged, and persists confirmation IDs; the baseline cannot start until all eight confirmations exist.

The fixed Hello World baseline uses literal platform source and tests, a normal append-only Git commit, credentialless isolated compilation/testing, staging and production HTTP checks, and an immutable platform-authored deployment. It creates no agent review or fictional agent achievement. Baseline preparation uses a dedicated platform reservation under the existing global daily allowance with a total $0.05 reset allowance, including the bounded archive batch estimate. Unknown charges stay reserved. Each attempt has a fenced publication lease and checked private checkpoint.

After publication, shared-only mode waits for a visitor suggestion. It does not restart idle conversations or personal work. Frozen visitor work can proceed beside preserved private goals; private assignments/scopes cannot cross into the new public loop.

Focused checks: `packages/domain/src/shared-reset.test.ts`, `apps/world/features/world-state/assignment.test.ts`, `apps/world/features/visitor-reset/reset.worker.ts`, `tooling/features/shared-reset/work.test.ts`, and `apps/execution/features/visitor-baseline/pipeline.test.ts`.

See [owner guide](guides/operator.md).
