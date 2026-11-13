# Public knowledge publication

Capability: `knowledge.catalogue`. Workflow: `knowledge.catalogue-integrity`.

Run `pnpm --filter @arti/knowledge build` to validate the canonical catalogue and generate `apps/knowledge/dist` directly from public-audience guide sources. The output includes static HTML, a local search script, styles, and a public catalogue JSON file. No live world database, private evidence, or agent memories are read.

The renderer supports headings, paragraphs, bold text, inline code, and fenced code. Raw HTML is escaped. Markdown link syntax remains text; the renderer never executes or follows author-supplied URLs. Definitions retain their verification label and do not become verified merely by being published.

`wrangler.jsonc` provides a separately deployable Worker with static assets and a restrictive content security policy. Deploy only after choosing the account and destination; no deployment is performed by the build. The Worker permits GET/HEAD and strips response cookies.

Canonical documents stay with their owning features. Generated HTML and JSON are rebuildable output, never editable source copies.
