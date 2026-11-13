# Bounded visitor review turns

Capability `world.visitor-governance` uses `EntityAgent.runGovernance()` for one fresh public review or deterministic steward transition. Workflow `world.visitor-review` joins these decisions to canonical suggestions and exact checked publications.

The world selects the action and identifiers; the model returns provider-constrained flat string decision fields and never supplies a command, actor, suggestion, task, goal revision, criterion or deployment identifier. The runtime constructs the canonical command. Scores use enumerated strings, criteria and assertions use bounded lines, and criterion review explicitly chooses verify or inconclusive. Its trusted publication observation ID is injected by the server; the actual returned page remains untrusted data. No historical private agent memory is sent to the model.

Every model call reserves $0.01 through the existing per-entity/global ledger with configured pricing and a conservative request bound. The existing activation, pause and release-fingerprint gates apply. Read-only deployment observation also reserves a bounded $0.01 charge. Neither path runs paid inference in simulation.

A separate durable `governancePending` record preserves the original command and idempotency key across uncertain delivery. Governance uses the same entity lease while retaining ordinary code continuations. It does not overwrite builder progress or update the personal-work cadence. No unrelated pending normal mutation may overlap a governance turn.

Focused checks: `pnpm exec vitest run apps/agent-runtime/features/visitor-governance apps/world/features/visitor-governance`.

See [developer guide](guides/developer.md).

Failures increment only fixed readiness, observation, model, arguments or delivery stage counters. These diagnostics contain no provider response, exception message, suggestion text or model reasoning. Model-stage failures include provider argument normalization; arguments-stage failures identify local decision validation.
