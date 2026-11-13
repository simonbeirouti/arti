# Use scoped application storage

Use the third fetch argument's `ctx.props.APP_DATA.get(key)`, `put(key,value)` and `delete(key)`. Keys are local record names, not paths or entity IDs. Use the provided capability only: generated code has no namespace binding. Author public API responses deliberately; stored application data can be published by the owning website. Keep secrets and private instructions out of application records.

For a scheduled service, add a job to `site/services.json` and implement its `/_arti/jobs/<id>` handler. Require `ctx.props.job` before work. The platform chooses the active immutable deployment, job ID and timestamp and prevents public requests from reaching reserved paths. Make business operations idempotent when interacting with several application records. A durable claim prevents repeat ticks but does not recover an interrupted job automatically.
