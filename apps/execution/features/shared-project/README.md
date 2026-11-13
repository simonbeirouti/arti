# Shared project execution

Capability `execution.publication`; workflow `execution.checked-publication`.

One registered `SharedProject` owns the canonical repository and public showcase. Contributors remain authenticated entities with individual budget accounting. For an assigned task, `codeScope` derives the project from authoritative records and returns a contributor/task fork such as `collective-builder-1-build`. A caller cannot select a project, canonical repository, or different contributor through model arguments. Project scope is included in the isolated public-authoring approval and pinned build request.

Cloud publication acquires a project-level lease, reads the project's canonical Artifacts head, builds the pinned fork without deployment credentials, smoke-checks staging, compares canonical state, promotes the checked revision, and records a project-scoped immutable production script. All reservations remain charged to the contributing entity. Replay checks include project identity and immutable bundle hash. Concurrent contributors share one version history and cannot promote outdated forks.

`SHOWCASE_HOSTNAME` optionally routes a dedicated showcase host; `collective.<ENTITY_DOMAIN>` also resolves the registered collective project. Operator cookies and authorization headers are stripped, upstream Set-Cookie is removed, and private `/_arti/` paths stay inaccessible. Application storage and scheduled-job claim namespaces are isolated by project ID, while scheduled-job usage is attributed to the deployment contributor. When shared projects are configured, legacy personal website hosts return 404 and legacy scheduled jobs are skipped without new reservations. Their repository history, deployments and data are retained. Legacy behavior is available only in an explicit projects-empty environment.

LocalExecution accepts `getProjects` and `context.projectId`. When projects are configured, initialization creates shared repositories and checked simulated starter deployments, without creating personal-site deployments. `site(projectId)`, `deployments(projectId)` and `rollback(projectId)` use project history. Publication contexts remain server-derived; root handlers must validate authenticated contributor/task ownership before invoking LocalExecution. The shared HTML renderer consumes public project metadata and public edited content only. No private goal text is generated into the starter page.

Local HTML publication is simulation evidence only. Cloudflare publication and provider execution require separate configured activation and real verification; none is implied by these local tests.

See [developer guide](guides/developer.md) and [walkthrough](walkthrough.json).
