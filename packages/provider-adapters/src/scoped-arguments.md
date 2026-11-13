# Scoped model arguments

When exactly one required tool has a closed flat-string argument schema, the platform selects the operation and asks GLM for only its JSON arguments through the standard `response_format.json_schema` wrapper. The response cannot select a tool name. Native/default and multiple-required-tool requests retain native function calling.

Malformed JSON, non-string values and unexpected native tool calls fail without repair, fallback or retries. The executor still validates exact fields, actor scope, pinned revisions, permissions and budgets. Length-truncated responses remain failures. Usage is recorded and measured cost settled before argument normalization; unavailable usage remains conservatively charged.

The real `scoped-structured-arguments` evaluation uses this same builder and normalizer. Local tests verify billing, malformed outputs, scope rejection and unchanged native paths; they do not establish cloud verification.

Cloudflare documents GLM's response-format input at https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/.
