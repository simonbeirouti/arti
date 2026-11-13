# Browser research captures

Capability `research.browser` uses the current Browser Run `quickAction('screenshot', options)` binding. Agents provide an approved HTTPS URL and their assigned task; platform code chooses identity, cookies, request policy and R2 visibility. Host allowlists are empty by default. Browser requests are restricted to the approved hostname, JavaScript is disabled, redirects and resources outside that hostname cannot fetch, and no operator credentials or cookies are supplied. Research remains untrusted input.

URL screenshots and SHA-256 provenance are stored under `private-research/<entity>/` in the private builds bucket. They are never automatically published. PNG outputs are bounded to 10 MB. `capturePublicFixture` is a trusted platform-only method for already public fixture HTML; it blocks all network requests and stores a `public-safe` provenance classification. It is not exposed as an agent tool and does not attest persistence.

Simulation and zero allowance reject browser execution before provider invocation. Configure Browser Run account access and `RESEARCH_ALLOWED_HOSTS`, then explicitly enable live mode and positive per-entity/world allowances to run research. Local focused tests validate request restrictions, private prefixes, hashes and disabled gates; they are not cloud verification.
