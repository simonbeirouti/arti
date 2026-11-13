# Environment inventory

| Environment | State | Paid dispatch |
| --- | --- | --- |
| Local simulation | Implemented; local SQLite/Git/sites | Always disabled |
| Cloudflare staging | Configuration templates; real-account verification pending | Disabled until explicitly configured and activated |
| Production | Release checklist only; no selected domains/resources | Disabled |

Wrangler files declare intended bindings. Replace placeholder IDs, origins and pinned image digest in a reviewed environment configuration. Keep tokens in Worker secrets, not this inventory. Track actual account resource IDs and verification receipts privately. Provider invoices are distinct from estimated ledger reservations.
