# Daily limits and retained liabilities

The configured world and entity allowances are daily dispatch limits, calculated by UTC day. Yesterday's dated unknown costs stay reserved in historical accounting but do not consume today's fresh allowance. The system may accumulate unsettled historical liabilities over multiple days; `outstandingReservedUsd` makes those visible separately. This policy does not claim estimates are provider invoices or erase potential charges.

A measured cost belongs to its reservation's creation day, even if the measurement arrives later. Settling yesterday's cost cannot consume or free today's capacity. Same-day measured overruns still block further same-day dispatch. Every genuinely new action requires a fresh current-day reservation; replaying an old reservation cannot create a new allowance.

Migration records unmatched legacy aggregate reserves as undated holds. A legacy aggregate spent residual remains attached to its recorded budget day; invalid or absent attribution remains conservative. Never clear these residuals merely to make deployment pass. Provider usage evidence is required for actual-cost reconciliation, and historical statuses must not be rewritten into fictional settlements.

Restore uses canonical reservation IDs to merge history, retains current allowance settings and preserves conservative residual maxima from both snapshots. Repeating migration, reading the world or restoring the same backup must not multiply or reset commitments. Evaluation allowance is a subset of the world allowance; prior-day running evaluations require a new explicitly authorised run before further paid dispatch.
