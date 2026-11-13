# Canonical domain accounting

Capability `world.daily-budget`; workflow `world.dispatch-day-budget`.

World authority retains every reservation and measured settlement. The daily admission budget uses the original dispatch date in UTC: `budget.reservedUsd` is today's reserved estimate plus undated legacy holds, and `budget.spentUsd` is today's original-dispatch measured usage. `budget.outstandingReservedUsd` and operations `reservedUsd` report every unsettled historical estimate, including undated aggregate residuals. A daily reset never marks an unknown cost settled or released.

`src/daily-budget.ts` owns one-time legacy migration, daily counters, entity commitments and conservative restore residuals. Its persisted `dispatch-day-v1` marker prevents aggregate residuals being recaptured or erased on restart. Existing receipts remain unchanged. A late measured settlement updates its original day while retaining the actual settlement timestamp. Undated reservations and unknown aggregate holds continue consuming daily capacity until independently resolved.

Both world and entity caps govern each new dispatch. Existing prior-day reservation IDs cannot authorise fresh activity. Evaluations share the world cap and cannot resume paid model/build dispatch under a prior-day run. Maintenance subset caps use the same original-day commitment rule. Restore merges reservation history, preserves current configured caps and conservatively retains residuals from both snapshots.

Focused checks: `pnpm exec vitest run packages/domain/src/daily-budget.test.ts packages/domain/src/evaluation-budget.test.ts packages/domain/src/index.test.ts`; real Worker checks: `pnpm exec vitest run --config vitest.workers.config.ts tests/workers/daily-budget.test.ts tests/workers/model-evaluations.test.ts tests/workers/maintenance.test.ts`.

See [accounting guide](guides/daily-budget.md).
