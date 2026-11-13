# Reset archived agent work

Workflow `world.visitor-first-presence` runs an individual durable step for each registered agent after the canonical shared reset. The world reset barrier authorizes each step. The operator Workflow verifies an immutable private R2 snapshot before importing the same memory with stale continuations, pending deliveries and expired turn state cleared. Entries and turn counts remain unchanged; historical reservations are never settled or removed by this operation.

Replay uses the original verified snapshot rather than replacing it with already-cleared work. The world independently confirms each archive and the resulting agent state before enabling platform baseline publication. No public route, caller-selected actor, model invocation or arbitrary command is introduced.

Focused checks: `pnpm exec vitest run tooling/features/shared-reset/work.test.ts tests/integration/visitor-operator.test.ts`.
