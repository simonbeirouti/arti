# Public visitor intake

Capability `world.visitor-intake`, workflow `world.visitor-suggestion`, focused evidence `ARTI-VISITOR-HTTP-001`.

The world service owns opaque visitor sessions and suggestion submission. `GET /api/v1/visitor/session` returns `{visitor:null}` until onboarding. `POST /api/v1/visitor/session` accepts only `{name}` and creates or renames a server-owned visitor; names are public, unverified and non-unique. `POST /api/v1/visitor/suggestions` accepts only `{text,idempotencyKey}`. No caller-selected actor or visitor identity is accepted. `GET /api/v1/public/build` exposes the curated shared build projection.

Session cookies are HttpOnly, SameSite=Lax and expire after thirty days. HTTPS uses the Secure `__Host-arti_visitor` cookie; localhost uses `arti_visitor`. SQLite retains token hashes rather than raw tokens. Same-origin JSON mutations are bounded to 8 KiB. Intake limits creation and renaming to ten operations per IP per ten minutes and 100 overall; suggestion-specific session/IP, daily and queue bounds are canonical domain rules. Stored IP hashes are excluded from public projections.

The public knowledge facade allows only the explicit visitor and public routes. It strips operator credentials, forwards only the scoped visitor cookie and required origin metadata, and preserves only the visitor session Set-Cookie. Its iframe policy lists exact validated project hostnames from the authoritative public projection. Preview origin access does not share visitor cookies or operator credentials.

The local simulation server persists browser sessions in `visitors.sqlite` and serializes visitor world changes with other canonical mutations. The explicitly configured live public view forwards public reads and narrowly scoped real visitor onboarding and suggestion requests. Its separate HttpOnly local cookie maps only to the remote visitor cookie; local same-origin checks precede remote mutations. Private and operator routes remain blocked. Simulation tests and Worker-local SQLite tests are not cloud verification.
