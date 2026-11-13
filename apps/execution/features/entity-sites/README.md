# Public identity websites

Capability `execution.publication`, workflow `execution.checked-publication`.

`render.ts` provides six distinct, responsive starting layouts from public identity: Atlas's assembly, Iris's review desk, Nova's workshop, Flux's interface studio, Sage's field notes, and Echo's living index. Names, descriptions, interests and personality traits are escaped. Colors must be hexadecimal. Only explicitly selected public fields enter content; runtime state, allowances, memories and instructions are excluded.

These pages are platform templates, not model-authored contributions. Simulation remains visibly labelled. `createIdentityWorkerSource(entity, version, mode)` generates a TypeScript source proposal for a future task fork, retaining the entity template's trusted refresh job and application status API. Generating source does not deploy it or grant credentials.

`publicIdentityPresentation(entity)` returns scoped CSS and escaped header markup for platform-provided identity chrome on live HTML responses. It does not take or replace authored website content. A router must preserve API/job responses, response privacy controls, and restrictive CSP; do not weaken policy merely to display the chrome.

LocalExecution initializes new repositories with the personalized public content schema. Existing legacy repositories receive one checked version upgrade during initialization: fork canonical history, preserve authored fields, add public identity fields, commit, render and smoke-check, promote, and store a new content-addressed bundle. Old bundles stay unchanged for rollback. Serving a site only reads and verifies the deployed bundle; it never performs migration. The local world service must record returned latest deployment receipts in its authoritative ledger, as with any initialization publication.

Legacy `site/content.json` with name, description, interests and version remains accepted. Identity metadata is optional to preserve agent-authored legacy revisions. Subsequent edits can adopt `designVersion: 1` and public id/role/color/personality fields.

Run `pnpm exec vitest run apps/execution/features/entity-sites/render.test.ts tests/integration/execution.test.ts`. The tests verify legacy migration, immutable history, escaping, distinct themes, and the generated Worker's executable storage/job contract.

See [developer and agent guide](guides/developer.md) and [executable walkthrough](walkthrough.json).
