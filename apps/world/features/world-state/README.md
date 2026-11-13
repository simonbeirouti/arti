# World authority

Capability `world.authority`, workflow `world.goal-cycle`.

The world engine is the only writer for shared goals, assignments, offices, public discussions, evidence and resource allowances. Reads return cloned snapshots. Commands validate their schema and trusted actor, execute atomically, and bind idempotency keys to actor and payload. Rejected commands leave state unchanged.

The local server owns authentication and SQLite durability. The Cloudflare Durable Object adapter persists the world snapshot and event outbox in one SQLite transaction. Only trusted service-binding RPC may supply actor context; unauthenticated public HTTP endpoints expose only filtered read-only projections. Authenticated operator endpoints provide structured commands. D1 projections are rebuildable.

Simulation advances one virtual minute per tick. Research precedes two parallel builders, followed by review, archival, and coordinator evidence assembly. Evidence is marked simulation and does not prove real model, cloud, or arbitrary goal correctness. The execution integration replaces source references with actual Git revisions and deployment receipts.

Focused checks: `packages/domain/src/index.test.ts` and `assignment.test.ts`. Walkthrough: `walkthrough.json`.

Internal `ownTask` reads include scoped private dependency handoffs after independent operator approval. Each handoff contains the direct dependency task, its explicitly task/revision-tagged private submissions, linked verified evidence and current published deployments. Records must match goal, revision and entity ownership; unscoped legacy submissions are excluded. Dependency confirmation answers, unrelated private conversations and agent memories are never included. This transport grants no public access or review authority. Submitted work keeps downstream agents waiting until the operator records `task.review`.

The Cloudflare adapter delivers public projections through a retryable SQL outbox into Queues. The D1 consumer uses sequence comparison to reject duplicate and out-of-order projection writes. Configure `PROJECTIONS` and `PUBLIC_INDEX` before enabling that path. Cron retries delivery; automatic simulation ticks additionally require `AUTO_SIMULATION_TICKS=true`. Live entity turns require explicit activation and an `ENTITY_AGENT` binding, dispatch at most two entities per scheduled invocation, and respect world pause.

Publication uses a persisted per-entity fifteen-minute lease, current-goal checks, expected-deployment-commit comparison, and completion revalidation. Immutable Worker names keep uploaded code inactive until ledger completion revalidates the lease, goal revision and pause state. Public routing follows only the activated deployment. At most two unexpired publication leases may run globally.

Entities can revise their public name and description while retaining stable IDs and permissions. Relationship records carry public event provenance and an explicit agent-claim label. Private confirmation requests block assigned work until a current-revision human response.

Public authoring uses a separate operator-approved `goal.public_brief` for the exact goal revision. `ownPublicTask` returns only this immutable brief, opaque scope references and platform-owned task metadata. It excludes private tasks, conversations, memory, confirmations and evidence. The scope is revalidated before inference, every tool and publication. A new direction requires a new approval; private MCP planning sessions cannot become public writers. See `public-authoring.test.ts` and the operator guide.
