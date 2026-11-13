import { runtimeFailureCodes } from '../../apps/agent-runtime/features/agent-turns/tool-failures';
import { z } from 'zod';

export const stagingOperatorRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('evaluate'), acknowledgement: z.literal('RUN_PAID_MODEL_EVALUATION') }).strict(),
  z.object({ operation: z.literal('visitor-configure'), acknowledgement: z.literal('CONFIGURE_VISITOR_WORLD') }).strict(),
  z.object({ operation: z.literal('visitor-step'), acknowledgement: z.literal('RUN_BOUNDED_VISITOR_STEP') }).strict(),
  z.object({ operation: z.literal('visitor-status'), acknowledgement: z.literal('INSPECT_VISITOR_WORLD') }).strict(),
  z.object({ operation: z.literal('visitor-reset'), acknowledgement: z.literal('RESET_SHARED_WEBSITE') }).strict(),
  z.object({ operation: z.literal('configure'), acknowledgement: z.literal('CONFIGURE_STAGING_WORLD') }).strict(),
  z.object({ operation: z.literal('activate'), acknowledgement: z.literal('ENABLE_LIVE_WORLD') }).strict(),
  z.object({ operation: z.literal('status'), acknowledgement: z.literal('INSPECT_STAGING_WORLD') }).strict(),
  z.object({ operation: z.literal('wake'), acknowledgement: z.literal('WAKE_LIVE_AGENTS') }).strict(),
  z.object({ operation: z.literal('backup-probe'), acknowledgement: z.literal('VERIFY_PAUSED_BACKUP_TRANSPORT') }).strict(),
  z.object({ operation: z.literal('backup'), acknowledgement: z.literal('BACK_UP_LIVE_WORLD') }).strict(),
  z.object({ operation: z.literal('pause'), acknowledgement: z.literal('PAUSE_LIVE_WORLD') }).strict(),
  z.object({ operation: z.literal('resume'), acknowledgement: z.literal('RESUME_LIVE_WORLD') }).strict(),
  z.object({ operation: z.literal('diagnostics'), acknowledgement: z.literal('INSPECT_LIVE_TURN_DIAGNOSTICS') }).strict(),
  z.object({ operation: z.literal('probe'), acknowledgement: z.literal('VERIFY_STAGING_REPOSITORY_TOOLS') }).strict(),
  z.object({ operation: z.literal('verify-turn'), acknowledgement: z.literal('RUN_BOUNDED_LIVE_RUNTIME_CHECK') }).strict(),
]);

export const stagingAgentCaps = { steward: 0.75, moderator: 0.75, 'builder-1': 1.25, 'builder-2': 1, 'builder-3': 0, 'builder-4': 0, researcher: 1, archivist: 0.25 } as const;

export const stagingWorldCap = 5;

const diagnosticTool = z.enum(['world.inspect', 'world.command', 'repo.fork', 'repo.read', 'repo.patch_commit', 'execution.request_build', 'research.retrieve', 'research.browser', 'data.get', 'data.put', 'data.delete']);

const successfulToolEntry = z.object({ tool: diagnosticTool, arguments: z.string(), observation: z.string() });

const failedToolEntry = z.object({ tool: z.union([diagnosticTool, z.literal('unknown')]), code: z.enum(['JSON_PARSE', 'ARGUMENT_SCHEMA', 'PERMISSION', 'EXECUTION_FAILED']), status: z.literal('failed') }).strict();

const runtimeFailureEntry = z.object({ type: z.literal('runtime.failure'), code: z.enum(runtimeFailureCodes) }).strict();

/** Memory-derived counts describe tool use; they do not independently verify successful world outcomes. */
export function turnDiagnostics(entries: string[]) {
  const counts = new Map<z.infer<typeof diagnosticTool>, number>();
  const latestTools: z.infer<typeof diagnosticTool>[] = [];
  const failureCodes: { tool: z.infer<typeof failedToolEntry>['tool']; code: z.infer<typeof failedToolEntry>['code']; count: number }[] = [];
  const runtimeFailures: { code: z.infer<typeof runtimeFailureEntry>['code']; count: number }[] = [];
  let failures = 0;

  for (const entry of entries) {
    if (entry === 'Tool failed; inspect permissions and revise the action') { failures += 1; continue; }

    let parsed: z.infer<typeof successfulToolEntry>;

    try {
      const value: unknown = JSON.parse(entry);
      const terminal = runtimeFailureEntry.safeParse(value);

      if (terminal.success) {
        const existing = runtimeFailures.find(item => item.code === terminal.data.code);

        if (existing) existing.count += 1;
        else runtimeFailures.push({ code: terminal.data.code, count: 1 });
        continue;
      }

      const failed = failedToolEntry.safeParse(value);

      if (failed.success) {
        failures += 1;
        const existing = failureCodes.find(item => item.tool === failed.data.tool && item.code === failed.data.code);

        if (existing) existing.count += 1;
        else failureCodes.push({ tool: failed.data.tool, code: failed.data.code, count: 1 });
        continue;
      }

      const result = successfulToolEntry.safeParse(value);

      if (!result.success) continue;

      parsed = result.data;
    } catch { continue; }

    counts.set(parsed.tool, (counts.get(parsed.tool) ?? 0) + 1);
    latestTools.push(parsed.tool);
  }

  return { entryCount: entries.length, successfulTools: Array.from(counts, ([tool, count]) => ({ tool, count })), failures, failureCodes, runtimeFailures, latestTools: latestTools.slice(-12) };
}

const safeProbeMessages = new Set(['Git operation failed', 'Trusted Git transport failed', 'Patch failed', 'Untrusted Git remote', 'Fresh transport container required', 'Missing patch input', 'Invalid entity patch', 'Invalid commit receipt', 'Source missing or too large', 'World paused', 'Personal code work waits for shared goals to close', 'A passed current-release model evaluation is required', 'Allowance exhausted']);

export function probeError(message: string): string { return safeProbeMessages.has(message) ? message : 'Repository probe failed'; }
