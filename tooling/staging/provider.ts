import { z } from "zod";

export type JsonValue = z.infer<ReturnType<typeof z.json>>;

/** Provider responses may contain credentials. Errors intentionally omit their bodies. */
export class CloudflareAdmin {
  constructor(
    private readonly token: string,
    private readonly accountId: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!token)
      throw new Error("CLOUDFLARE_API_TOKEN is required for inspect/apply");
  }
  async call<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    schema: z.ZodType<T>,
    body?: JsonValue,
  ): Promise<T | null> {
    const response = await this.request(
      `https://api.cloudflare.com/client/v4${path}`,
      {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ).catch(() => {
      throw new Error(`Cloudflare ${method} request failed`);
    });

    if (response.status === 404 && method === "GET") return null;

    if (!response.ok)
      throw new Error(`Cloudflare ${method} failed (HTTP ${response.status})`);

    const payload = await response.json().catch(() => {
      throw new Error('Cloudflare response was not valid JSON');
    });

    const envelope = z
      .object({ success: z.boolean(), result: schema })
      .safeParse(payload);

    if (!envelope.success || !envelope.data.success)
      throw new Error(`Cloudflare ${method} returned an invalid response`);

    return envelope.data.result;
  }
  path(suffix: string) {
    return `/accounts/${this.accountId}${suffix}`;
  }
  async list<T>(suffix: string, schema: z.ZodType<T>): Promise<T[]> {
    const records: T[] = [];

    for (let page = 1; page <= 100; page++) {
      const result = await this.call(
        "GET",
        this.path(
          `${suffix}${suffix.includes("?") ? "&" : "?"}page=${page}&per_page=100`,
        ),
        z.array(schema),
      );

      if (!result) throw new Error("Cloudflare inventory endpoint unavailable");
      records.push(...result);

      if (result.length < 100) return records;
    }

    throw new Error(
      "Cloudflare inventory pagination limit reached; refusing partial inventory",
    );
  }
}

export const queueRecord = z.object({
  queue_id: z.string(),
  queue_name: z.string(),
});

export const repositoryRecord = z.object({
  name: z.string(),
  default_branch: z.string(),
  read_only: z.boolean(),
  last_push_at: z.string().nullable(),
});

export const subscriptionRecord = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  source: z.object({
    type: z.string(),
    namespace: z.string().optional(),
    repo_name: z.string().optional(),
  }),
  destination: z.object({ type: z.string(), queue_id: z.string() }),
  events: z.array(z.string()),
});

export async function ensurePushSubscription(
  admin: CloudflareAdmin,
  namespace: string,
  repository: string,
  queueId: string,
  apply: boolean,
) {
  const name = `${namespace}-${repository}-push`;

  const matches = (
    await admin.list("/event_subscriptions/subscriptions", subscriptionRecord)
  ).filter((item) => item.name === name);

  if (matches.length > 1) throw new Error(`Duplicate subscription ${name}`);
  const existing = matches[0];

  if (existing) {
    if (
      !existing.enabled ||
      existing.source.type !== "artifacts.repo" ||
      existing.source.namespace !== namespace ||
      existing.source.repo_name !== repository ||
      existing.destination.type !== "queues.queue" ||
      existing.destination.queue_id !== queueId ||
      existing.events.length !== 1 ||
      existing.events[0] !== "pushed"
    )
      throw new Error(`Subscription drift: ${name}`);

    return existing.id;
  }

  if (!apply) throw new Error(`Missing subscription ${name}`);

  const created = await admin.call(
    "POST",
    admin.path("/event_subscriptions/subscriptions"),
    subscriptionRecord,
    {
      name,
      enabled: true,
      source: { type: "artifacts.repo", namespace, repo_name: repository },
      destination: { type: "queues.queue", queue_id: queueId },
      events: ["pushed"],
    },
  );

  if (!created) throw new Error(`Subscription creation failed: ${name}`);

  return created.id;
}
