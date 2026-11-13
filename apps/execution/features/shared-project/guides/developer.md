# Working on the shared codebase

Guide `execution.shared-project.guide`; audience: developer, agent, operator.

1. Register the project in world authority with stable ID and canonical repository name.
2. Start a goal whose assigned tasks carry that project ID. Approve a public authoring brief separately from private goal setup.
3. The contributor uses its authenticated scoped tools. The server derives the canonical repository and contributor task fork.
4. Read and modify public site, tests and content in the fork. Request a build of the exact source commit.
5. The platform checks the fork, captures evidence, stages, authorizes the current goal revision, promotes canonical Git using compare-and-swap, then uploads and records the immutable project release.
6. Observe project version and showcase content. A verified deployment is evidence for a task; human acceptance still determines shared-goal completion.

Do not broaden model arguments to accept account credentials, contributor IDs, project targets, or deployment commands. Do not expose private goal setup, memories or build evidence in showcase content. Legacy goals without a project ID retain their previous entity scope.

For local development, configure `LocalExecution.getProjects`, synchronize initialization receipts into world authority, and route the showcase to `execution.site('collective')`. Simulation labels must remain visible.
