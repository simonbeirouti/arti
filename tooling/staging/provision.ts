import { z } from "zod";
import {
  repositoryIds,
  resourceNames,
  type ResourceInventory,
  type StagingConfiguration,
} from "./configuration";
import {
  CloudflareAdmin,
  ensurePushSubscription,
  queueRecord,
  repositoryRecord,
  type JsonValue,
} from "./provider";

/** Creation issues a Git token; metadata GET deliberately has a separate schema. */
export async function ensureCanonicalRepository(admin: CloudflareAdmin, namespace: string, id: string, apply: boolean): Promise<z.infer<typeof repositoryRecord>> {
  z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u).parse(namespace);
  z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/u).parse(id);
  const path = `/artifacts/namespaces/${namespace}/repos`;
  let repo = await admin.call('GET', admin.path(`${path}/${id}`), repositoryRecord);

  if (!repo) {
    if (!apply) throw new Error(`Missing repository ${id}`);
    const created = await admin.call('POST', admin.path(path), z.object({ name: z.string(), default_branch: z.string() }), { name: id, default_branch: 'main', read_only: false });

    if (!created || created.name !== id || created.default_branch !== 'main') throw new Error('Repository creation failed');
    repo = await admin.call('GET', admin.path(`${path}/${id}`), repositoryRecord);
  }

  if (!repo || repo.name !== id || repo.default_branch !== 'main' || repo.read_only) throw new Error(`Repository configuration drift ${id}`);

  if (apply && repo.last_push_at === null) {
    // Also recover an interrupted creation/revocation on retry. Empty canonical
    // repositories are platform-owned and have no deployed agent history yet.
    const tokens = await admin.list(`${path}/${id}/tokens?state=active`, z.object({ id: z.string() }));

    for (const token of tokens) {
      const revoked = await admin.call('DELETE', admin.path(`/artifacts/namespaces/${namespace}/tokens/${encodeURIComponent(token.id)}`), z.object({ id: z.string() }));

      if (!revoked || revoked.id !== token.id) throw new Error('Repository token revocation failed');
    }
  }

  return repo;
}

export function provisionPlan(config: StagingConfiguration) {
  return {
    environment: config.environment,
    accountId: config.accountId,
    names: resourceNames(config),
    repositories: repositoryIds,
    domains: config.domains,
    publicationEnabled: false,
    actions: [
      config.hosting === "workers-dev" ? "verify existing Access application, account workers.dev subdomain and any entity zone ownership" : "verify existing Access application and zone ownership",
      "discover or create D1, private R2 buckets, queues, dispatch and Artifacts namespaces",
      "create eight agent repositories and the collective canonical repository; never overwrite existing history",
      "seed empty repositories from trusted template",
      "ensure nine repository push subscriptions",
      "generate five disabled Worker configurations",
    ],
    liveActivated: false,
    dailyUsd: 0,
    requestedQuotas: config.quotas,
  };
}

export async function provision(
  config: StagingConfiguration,
  admin: CloudflareAdmin,
  apply: boolean,
): Promise<ResourceInventory> {
  const n = resourceNames(config);

  const organization = await admin.call(
    "GET",
    admin.path("/access/organizations"),
    z.object({ auth_domain: z.string() }),
  );

  if (!organization || organization.auth_domain !== config.access.teamDomain)
    throw new Error("Access team domain does not match this account");

  const app = await admin.call(
    "GET",
    admin.path(`/access/apps/${config.access.applicationId}`),
    z.object({ domain: z.string(), aud: z.string(), type: z.string() }),
  );

  if (
    !app ||
    app.domain !== config.domains.operator.hostname ||
    app.aud !== config.access.audience ||
    app.type !== "self_hosted"
  )
    throw new Error("Access application domain/audience/type mismatch");

  const policies = await admin.list(
    `/access/apps/${config.access.applicationId}/policies`,
    z.object({ decision: z.string(), include: z.array(z.json()) }),
  );

  const allowed = new Set(config.access.operatorEmails);
  const authorized = new Set<string>();

  for (const policy of policies) {
    if (policy.decision !== "allow")
      throw new Error(
        "Access policy must use explicit operator email allow rules; review bypass/service policies manually",
      );

    for (const rule of policy.include) {
      const email = z
        .object({ email: z.object({ email: z.email() }).strict() })
        .strict()
        .safeParse(rule);

      if (!email.success || !allowed.has(email.data.email.email))
        throw new Error(
          "Access policy contains broader access than configured operator emails",
        );
      authorized.add(email.data.email.email);
    }
  }

  for (const email of allowed)
    if (!authorized.has(email))
      throw new Error("Configured operator email missing from Access policy");

  if (config.hosting === "workers-dev") {
    const subdomain = await admin.call("GET", admin.path("/workers/subdomain"), z.object({ subdomain: z.string() }));

    if (subdomain?.subdomain !== config.workersDevSubdomain)
      throw new Error("workers.dev subdomain does not match this account");
  }

  for (const domain of Object.values(config.domains)) {
    if (!domain?.zoneId) continue;

    const zone = await admin.call(
      "GET",
      `/zones/${domain.zoneId}`,
      z.object({
        name: z.string(),
        account: z.object({ id: z.string() }),
        status: z.string(),
      }),
    );

    if (
      !zone ||
      zone.account.id !== config.accountId ||
      zone.status !== "active" ||
      !(
        domain.hostname === zone.name ||
        domain.hostname.endsWith(`.${zone.name}`)
      )
    )
      throw new Error(
        "Domain zone does not belong to the configured active account",
      );
  }

  const ensure = async (path: string, body: JsonValue) => {
    const existing = await admin.call("GET", admin.path(path), z.json());

    if (existing !== null) return;

    if (!apply) throw new Error(`Missing resource ${path}`);
    await admin.call(
      "POST",
      admin.path(path.substring(0, path.lastIndexOf("/"))),
      z.json(),
      body,
    );
  };

  for (const namespace of [n.staging, n.production])
    await ensure(`/workers/dispatch/namespaces/${namespace}`, {
      name: namespace,
    });
  await ensure(`/artifacts/namespaces/${n.artifacts}`, {
    namespace: n.artifacts,
  });

  for (const bucket of [n.builds, n.backups]) {
    await ensure(`/r2/buckets/${bucket}`, { name: bucket });

    const managed = await admin.call(
      "GET",
      admin.path(`/r2/buckets/${bucket}/domains/managed`),
      z.object({ enabled: z.boolean() }),
    );

    const custom = await admin.call(
      "GET",
      admin.path(`/r2/buckets/${bucket}/domains/custom`),
      z.object({ domains: z.array(z.object({ enabled: z.boolean() })) }),
    );

    if (
      !managed ||
      !custom ||
      managed.enabled ||
      custom.domains.some((domain) => domain.enabled)
    )
      throw new Error(`Private bucket has public access: ${bucket}`);
  }

  const databases = await admin.list(
    "/d1/database",
    z.object({ uuid: z.uuid(), name: z.string() }),
  );

  const matches = databases.filter((database) => database.name === n.database);

  if (matches.length > 1) throw new Error("Duplicate D1 database name");
  let database = matches[0];

  if (!database) {
    if (!apply) throw new Error(`Missing database ${n.database}`);

    const created = await admin.call(
      "POST",
      admin.path("/d1/database"),
      z.object({ uuid: z.uuid(), name: z.string() }),
      { name: n.database },
    );

    if (!created) throw new Error("Database creation failed");
    database = created;
  }

  const discoveredQueues = await admin.list("/queues", queueRecord);
  const queues: Record<string, string> = {};

  for (const name of [n.events, n.dead, n.projections, n.projectionDead]) {
    const matches = discoveredQueues.filter(
      (queue) => queue.queue_name === name,
    );

    if (matches.length > 1) throw new Error(`Duplicate queue ${name}`);
    let queue = matches[0];

    if (!queue) {
      if (!apply) throw new Error(`Missing queue ${name}`);

      const created = await admin.call(
        "POST",
        admin.path("/queues"),
        queueRecord,
        { queue_name: name },
      );

      if (!created) throw new Error("Queue creation failed");
      queue = created;
    }

    queues[name] = queue.queue_id;
  }

  const subscriptions: Record<string, string> = {};

  for (const id of repositoryIds) {
    await ensureCanonicalRepository(admin, n.artifacts, id, apply);
    subscriptions[id] = await ensurePushSubscription(
      admin,
      n.artifacts,
      id,
      queues[n.events],
      apply,
    );
  }

  return {
    schemaVersion: 1,
    environment: "staging",
    accountId: config.accountId,
    prefix: config.prefix,
    checkedAt: new Date().toISOString(),
    accessVerified: true,
    databaseId: database.uuid,
    queues,
    repositories: [...repositoryIds],
    subscriptions,
  };
}
