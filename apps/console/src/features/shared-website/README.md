# Shared website

`UI-SHARED-WEBSITE-001` is the public visitor experience at `/world` and `/showcase`. It replaces the public map with the current goal, conversation and isolated website preview. Operator controls retain their authenticated entrypoint.

The world service is authoritative for visitor identity, suggestions, structured agent reviews and votes, task progress and releases. This UI reads `/api/v1/public/build` every four seconds, loads `/api/v1/visitor/session`, saves a public display name through that session endpoint, and submits suggestions to `/api/v1/visitor/suggestions` with a stable idempotency key retained across retries. Names are public and unverified; the browser never supplies actor identity.

Desktop uses two equal columns. The goal uses a compact desktop height of `clamp(140px, 20dvh, 190px)` and conversation fills the remaining left column. Goal and conversation scroll independently. Narrow screens stack the goal, conversation and preview. Public display names and suggestions are rendered as text. Only public discussions and events appear in the timeline.

The iframe uses `sandbox="allow-scripts"` and `referrerPolicy="no-referrer"`. A matching checked deployment and the project's authoritative active version are required before a preview appears. Automatic refresh remounts only when the active deployment ID changes. There is no preview toolbar or manual refresh mode. Simulated agent rows and an empty simulation preview retain explicit provenance; controlled browser fixtures do not establish cloud verification.

Focused checks: `pnpm exec vitest run apps/console/src/features/shared-website/shared-website.test.ts`. Browser acceptance covers name persistence, submission, review decisions, the compact desktop goal height, compact agent chips and expandable task details, narrow stacking, stable iframe during discussion polling and automatic release refresh.

The eligible queue rank is derived from all three scored dimensions across recorded votes, descending, then submission time. Identical reviewed briefs are not repeated. Generic review/vote events are represented by the proposal card; selection, completion and publication remain timeline updates. A local read-only mirror explains that suggestions belong on the deployed host.

Browser check: `pnpm exec playwright test --config apps/console/src/features/shared-website/playwright.config.ts`. This co-located browser fixture tests the UI against controlled public endpoint responses; it is not production or cloud evidence.

Conversation follows new content while the visitor is within 80 pixels of the bottom. Scrolling back through older messages pauses following; a successful suggestion returns to the latest activity. Unchanged polling snapshots do not move the scroll position.

The goal keeps attribution, status and checked task counts inline. The first three responsible agents and a remaining-agent count stay visible; full task details expand on demand. Conversation distinguishes visitors, agents and team updates, with inline timestamps and primary voting decisions. Acceptance criteria and dimension scores live in a native disclosure. The composer uses a visually hidden accessible label, the placeholder “Suggest an improvement”, and a compact Send button inside the input wrapper. Public-name onboarding retains its visibility disclosure. The goal has no separate brand/status header, and the preview uses its whole panel without a toolbar or banner.

The goal uses vertically centred inset quotation typography while keeping attribution and progress compact. Long goal content remains scrollable. Conversation has an accessible region name without a visible title or header. New visitors enter their public name through a translucent panel over the lower conversation; the surrounding chat remains readable and interactive. After onboarding, their name/Edit controls sit inside the suggestion input. Read-only mirrors show an honest preview-only overlay rather than a form that cannot submit.

Visitor session loading retries up to three times with an eight-second timeout per request. Exhausted attempts show an actionable Retry connection control in the translucent gate. Name entry only appears after the server session resolves. Build polling errors preserve the authenticated visitor and in-progress suggestion draft.
