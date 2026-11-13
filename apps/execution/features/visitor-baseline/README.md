# Platform Hello World baseline

Capability `world.visitor-governance`, workflow `world.visitor-first-presence`, evidence `execution.platform-baseline`.

The owner-only account Workflow invokes `ExecutionGateway.bootstrapVisitorBaseline(resetId)` after the matching world reset is paused. No HTTP route or agent tool accepts this operation, source text or actor identity. World authority provides a reset-scoped publication lease and a $0.05 total bootstrap allowance across attempts. Each provider dispatch reserves a fresh hold through that authority; unknown costs remain retained.

The platform appends one fixed commit to the existing collective repository, preserving all Git history. The commit replaces only the public Worker, its platform tests and an empty services manifest. It contains a minimal “Hello, world.” page with “The first page. Ready to grow.” and explicit platform provenance. Arbitrary previous repository files are not imported into this compiled Worker. Git credentials exist only in the separate transport container; the checked build runs without network or provider secrets.

The pipeline reuses the existing checked sandbox, immutable bundle store, credential-free staging and production smoke requests and trusted uploader. It verifies Hello World content before recording the canonical production version-one receipt. Platform provenance is explicit; the steward is only the responsible coordinator. No agent authorship, human acceptance or independent agent review is manufactured.

A private reset checkpoint retains the exact baseline source hash, checked canonical commit and compiled bundle hash for recovery. A retry must match the current canonical revision and fixed trusted files. Already recorded completion returns the saved deployment without redispatch. Failure leaves the reset barrier and spending holds in place, releases the attempt lease, and never claims a new canonical publication. Tests compile the actual fixed source and run its platform assertions, then cover failed staging checks, stale checkpoints, unknown delivery and duplicate completion without making provider calls.

See the co-located [operator guide](guides/operator.md) for the private reset Workflow and recovery boundary.
