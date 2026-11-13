import { z } from 'zod';

export const alertConfigurationSchema = z.object({ enabled: z.boolean(), deliveryAuthorized: z.boolean(), url: z.string().url().optional(), allowedHost: z.string().optional() });

export type AlertConfiguration = z.infer<typeof alertConfigurationSchema>;

export type OperationsAlert = { type: 'arti.operations'; environment: string; blockedTasks: number; projectionLag: number; pendingProjection: number; failures: number };

/** Configuration is operator-owned. Payloads contain counters, never model output or private work. */
export async function deliverOperationsAlert(configuration: AlertConfiguration, alert: OperationsAlert, send: typeof fetch = fetch): Promise<boolean> {
  const parsed = alertConfigurationSchema.parse(configuration);

  if (!parsed.enabled || !parsed.deliveryAuthorized || !parsed.url || !parsed.allowedHost) return false;
  const target = new URL(parsed.url);

  if (target.protocol !== 'https:' || target.hostname !== parsed.allowedHost || target.username || target.password || target.hash) throw new Error('Alert webhook scope invalid');
  const response = await send(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alert), redirect: 'error', signal: AbortSignal.timeout(10000) });

  if (!response.ok) throw new Error('Alert webhook rejected delivery');

  return true;
}
