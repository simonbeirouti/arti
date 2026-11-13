# Private backup and restore

Stop the local server, then run:

```sh
pnpm backup /absolute/path/to/new-private-backup
pnpm backup restore /absolute/path/to/private-backup /absolute/path/to/new-data
ARTI_DATA_ROOT=/absolute/path/to/new-data pnpm dev
```

Backups include consistent SQLite snapshots, canonical Git repositories, workspaces, bundles and deployment records. A SHA-256 manifest rejects missing, extra or modified files during restore. Restore writes a new directory and remaps local workspace paths. Agent tokens are excluded and regenerate on startup. Store backups outside all web roots; they include private memories and goals. A regression test exercises restore and tamper rejection.

Configured cloud backups write private v2 manifests containing world state, six private entity-memory snapshots and checksummed R2 references to canonical Git exports and application records/job claims. Exports drain and freeze the world before capturing state. Restore validates the entire manifest and referenced blobs before mutation, stays paused on partial failure, and preserves current paid usage and allowance caps. Git exports currently support compressed canonical repositories up to 600 KB; oversized repositories fail visibly. Retain uploaded immutable Workers, compiled bundles and evidence independently: restoring a ledger cannot recreate a deleted provider Worker. Keep deployment configuration in version control and credentials in secret storage. See [cloud recovery controls](../../apps/world/features/operations/README.md). Never publish backup keys or content through the public knowledge index.

For staging recovery, pause dispatch, export current state, validate the source snapshot and environment, restore through the operator path, rebuild D1 projections and inspect entity/task/deployment references before resuming. Rehearse in a disposable staging environment; manifests are pinned to their configured environment and cannot be imported into another environment without a separately reviewed migration. Code rollback restores a previous bundle; it does not roll back database writes or external side effects.
