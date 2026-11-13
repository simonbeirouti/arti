# Knowledge and evidence

Arti links capabilities, implementation, workflows, guides and execution evidence through stable IDs. Feature guides live with their owning code. The knowledge site renders those canonical files instead of maintaining copies.

The public world is at `/world`; public knowledge is served on local port 4174. Each entity has an independent site and a public discussion feed. Human goal intake, private goal sessions, memory and execution evidence are excluded from public projections.

## Verification status

A catalogue definition describes intended behaviour. It does not establish that the workflow ran. Simulation evidence verifies deterministic fixture orchestration only. Staging and production require separate execution receipts linked to an exact commit, environment and saved-result checks.

Screenshots show visible state. Assertions and independently read persisted records establish an outcome. Changed source or dependencies invalidate applicable evidence. Public captures use public-safe fixtures.

## Contribution

Add a capability manifest in `catalog/capabilities`, a workflow in `catalog/workflows`, and canonical guides in the owning feature. Register each guide once in `catalog/guides.json`. Run `pnpm catalog:check` to validate IDs and file references. Audience labels determine which guides can appear in public search.

## Evidence chain

Goal → task → acting entity → capability/workflow → source commit → verified outcome → deployment → guide.

Indexes are derived and rebuildable. Authority remains in the world ledger, Git history and immutable evidence objects.
