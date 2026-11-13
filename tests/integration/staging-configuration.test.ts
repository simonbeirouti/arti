import { describe, expect, it } from "vitest";
import {
  entityIds,
  repositoryIds,
  resourceInventory,
  resourceNames,
  stagingConfiguration,
  validateInventory,
} from "../../tooling/staging/configuration";
import { generateConfigurations } from "../../tooling/staging/generate";
import {
  CloudflareAdmin,
  ensurePushSubscription,
} from "../../tooling/staging/provider";
import { provision, provisionPlan } from "../../tooling/staging/provision";

const accountId = "a".repeat(32);

const zoneId = "b".repeat(32);

const configuration = {
  schemaVersion: 1,
  environment: "staging",
  prefix: "arti-demo-staging",
  accountId,
  domains: {
    operator: { hostname: "console.example.co.uk", zoneId },
    knowledge: { hostname: "knowledge.example.co.uk", zoneId },
    entities: { hostname: "agents.another.co.uk", zoneId },
  },
  access: {
    applicationId: "10000000-0000-4000-8000-000000000001",
    teamDomain: "arti.cloudflareaccess.com",
    audience: "c".repeat(64),
    operatorEmails: ["operator@example.com"],
  },
  approvedResearchHosts: ["developers.cloudflare.com"],
  quotas: {
    dailyUsd: 5,
    entityDailyUsd: {
      steward: 1,
      moderator: 0.75,
      "builder-1": 1,
      "builder-2": 1,
      "builder-3": 0.5,
      "builder-4": 0.5,
      researcher: 1,
      archivist: 0.25,
    },
    maxConcurrentBuilds: 2,
  },
  buildImage: `registry.cloudflare.com/${accountId}/arti-build@sha256:${"d".repeat(64)}`,
};

const workersDevConfiguration = {
  ...configuration,
  hosting: "workers-dev",
  workersDevSubdomain: "test-account",
  domains: {
    operator: { hostname: `${configuration.prefix}-world.test-account.workers.dev` },
    knowledge: { hostname: `${configuration.prefix}.test-account.workers.dev` },
  },
  buildImage: undefined,
};

const hybridConfiguration = {
  ...workersDevConfiguration,
  domains: {
    ...workersDevConfiguration.domains,
    entities: configuration.domains.entities,
  },
  buildImage: configuration.buildImage,
};

function inventory() {
  const config = stagingConfiguration.parse(configuration);
  const names = resourceNames(config);

  return resourceInventory.parse({
    schemaVersion: 1,
    environment: "staging",
    prefix: config.prefix,
    accountId,
    checkedAt: "2026-10-12T00:00:00.000Z",
    accessVerified: true,
    databaseId: "20000000-0000-4000-8000-000000000001",
    queues: {
      [names.events]: "event-id",
      [names.dead]: "dead-id",
      [names.projections]: "projection-id",
      [names.projectionDead]: "projection-dead-id",
    },
    repositories: repositoryIds,
    subscriptions: Object.fromEntries(
      repositoryIds.map((id) => [id, `${id}-subscription`]),
    ),
  });
}

describe("staging configuration and non-secret generation", () => {
  it("covers eight agents and the shared canonical repository without replacing personal history", () => {
    expect(entityIds).toEqual(['steward', 'moderator', 'builder-1', 'builder-2', 'builder-3', 'builder-4', 'researcher', 'archivist']);
    expect(repositoryIds).toEqual([...entityIds, 'collective']);
    expect(provisionPlan(stagingConfiguration.parse(configuration)).repositories).toEqual(repositoryIds);
    const config = stagingConfiguration.parse(configuration);
    expect(() => validateInventory(config, { ...inventory(), repositories: [...entityIds] })).toThrow('collective');
    expect(stagingConfiguration.safeParse({ ...configuration, quotas: { ...configuration.quotas, entityDailyUsd: { ...configuration.quotas.entityDailyUsd, 'builder-3': undefined } } }).success).toBe(false);
  });
  it("rejects entity hosting under the same registrable domain, including co.uk", () => {
    expect(
      stagingConfiguration.safeParse({
        ...configuration,
        domains: {
          ...configuration.domains,
          entities: { hostname: "agents.example.co.uk", zoneId },
        },
      }).success,
    ).toBe(false);
  });
  it("rejects private suffix siblings and unknown secret config fields", () => {
    expect(
      stagingConfiguration.safeParse({ ...configuration, token: "secret" })
        .success,
    ).toBe(false);

    const domains = {
      operator: { hostname: "console.tenant.github.io", zoneId },
      knowledge: { hostname: "docs.tenant.github.io", zoneId },
      entities: { hostname: "agent.tenant.github.io", zoneId },
    };

    expect(
      stagingConfiguration.safeParse({ ...configuration, domains }).success,
    ).toBe(false);
  });
  it("rejects unpinned images, cross-account images and placeholders", () => {
    for (const image of [
      "registry.cloudflare.com/image:latest",
      configuration.buildImage.replace(accountId, "e".repeat(32)),
      configuration.buildImage.replace("d".repeat(64), "0".repeat(64)),
    ])
      expect(
        stagingConfiguration.safeParse({ ...configuration, buildImage: image })
          .success,
      ).toBe(false);
  });
  it("plans offline with requested $5 caps while live dispatch stays disabled", () => {
    const plan = provisionPlan(stagingConfiguration.parse(configuration));
    expect(plan.requestedQuotas.dailyUsd).toBe(5);
    expect(plan.liveActivated).toBe(false);
    expect(plan.dailyUsd).toBe(0);
    expect(plan.publicationEnabled).toBe(false);
    expect(
      Object.values(plan.names).every((name) =>
        name.startsWith(configuration.prefix),
      ),
    ).toBe(true);
  });
  it("generates all cross-service resources in the isolated namespace and disabled gates", () => {
    const config = stagingConfiguration.parse(configuration);
    const generated = generateConfigurations(config, inventory(), "/repo");
    expect(Object.keys(generated)).toEqual([
      "world",
      "agent",
      "execution",
      "outbound",
      "knowledge",
    ]);
    expect(generated.world.vars.LIVE_ACTIVATED).toBe("false");
    expect(generated.agent.vars.DAILY_ALLOWANCE_USD).toBe("0");
    expect(generated.world.vars.EVALUATIONS_ENABLED).toBe("false");
    expect(generated.execution.vars.EVALUATIONS_ENABLED).toBe("false");
    expect(generated.world.vars.PUBLICATION_ENABLED).toBe("false");
    expect(generated.execution.vars.PUBLICATION_ENABLED).toBe("false");
    expect(
      generated.execution.dispatch_namespaces.every(
        (item) =>
          item.namespace.startsWith(config.prefix) &&
          item.outbound.service.startsWith(config.prefix),
      ),
    ).toBe(true);
    expect(
      generated.execution.durable_objects.bindings.some(
        (binding) => binding.name === "APP_DATA",
      ),
    ).toBe(true);
    expect(generated.execution.containers[0].images.build.image).toBe(
      config.buildImage,
    );
    expect(generated.world.services[0].service).toBe(generated.execution.name);

    for (const worker of [generated.world, generated.agent, generated.execution]) {
      expect(worker.durable_objects.code_update_strategy).toEqual({ mode: "immediate" });
    }

    expect(JSON.stringify(generated)).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(generated.world.workers_dev).toBe(false);
    expect(generated.execution.routes).toEqual(repositoryIds.flatMap(entityId => [
      { pattern: `${entityId}.agents.another.co.uk`, custom_domain: true, zone_id: zoneId },
      { pattern: `${entityId}.agents.another.co.uk/*`, zone_id: zoneId },
    ]));
  });
  it("generates workers.dev trusted hosts without opening agent sites, previews or internal services", () => {
    const config = stagingConfiguration.parse(workersDevConfiguration);
    const generated = generateConfigurations(config, inventory(), "/repo");

    expect(generated.world.workers_dev).toBe(true);
    expect(generated.knowledge.workers_dev).toBe(true);
    expect(generated.knowledge.name).toBe(configuration.prefix);
    expect(generated.world.routes).toEqual([]);
    expect(generated.knowledge.routes).toEqual([]);
    expect(generated.world.vars.OPERATOR_ORIGIN).toBe(`https://${workersDevConfiguration.domains.operator.hostname}`);
    expect(generated.world.vars.ACCESS_AUDIENCE).toBe(configuration.access.audience);
    expect(generated.execution.routes).toEqual([]);
    expect(generated.execution.vars.PUBLICATION_ENABLED).toBe("false");
    expect(generated.execution.vars.ENTITY_DOMAIN).toBe("");
    expect(generated.execution.containers).toEqual([]);
    expect(generated.execution.durable_objects.bindings.some(binding => binding.name === "BUILD_SANDBOX")).toBe(false);

    for (const worker of [generated.world, generated.agent, generated.execution]) {
      expect(worker.durable_objects.code_update_strategy).toEqual({ mode: "immediate" });
    }

    for (const worker of [generated.agent, generated.execution, generated.outbound]) expect(worker.workers_dev).toBe(false);

    for (const worker of Object.values(generated)) expect(worker.preview_urls).toBe(false);
    expect(generated.world.vars.LIVE_ACTIVATED).toBe("false");
    expect(generated.agent.vars.DAILY_ALLOWANCE_USD).toBe("0");
  });
  it("generates hybrid entity routing without activating publication or opening execution defaults", () => {
    const config = stagingConfiguration.parse(hybridConfiguration);
    const generated = generateConfigurations(config, inventory(), "/repo");

    expect(generated.world.workers_dev).toBe(true);
    expect(generated.knowledge.workers_dev).toBe(true);
    expect(generated.world.routes).toEqual([]);
    expect(generated.knowledge.routes).toEqual([]);
    expect(generated.execution.routes).toEqual(repositoryIds.flatMap(entityId => [
      { pattern: `${entityId}.agents.another.co.uk`, custom_domain: true, zone_id: zoneId },
      { pattern: `${entityId}.agents.another.co.uk/*`, zone_id: zoneId },
    ]));
    expect(generated.execution.vars.ENTITY_DOMAIN).toBe("agents.another.co.uk");
    expect(generated.execution.containers[0].images.build.image).toBe(configuration.buildImage);
    expect(generated.world.vars.PUBLICATION_ENABLED).toBe("false");
    expect(generated.execution.vars.PUBLICATION_ENABLED).toBe("false");
    expect(generated.execution.workers_dev).toBe(false);
    expect(generated.execution.preview_urls).toBe(false);
    expect(generated.world.vars.LIVE_ACTIVATED).toBe("false");
  });
  it("rejects workers.dev account/name mismatch, incomplete entity hosting and custom-domain config omissions", () => {
    for (const value of [
      { ...workersDevConfiguration, workersDevSubdomain: "other-account" },
      { ...workersDevConfiguration, domains: { ...workersDevConfiguration.domains, knowledge: { hostname: "different.test-account.workers.dev" } } },
      { ...hybridConfiguration, buildImage: undefined },
      { ...hybridConfiguration, domains: { ...hybridConfiguration.domains, entities: { hostname: "agents.another.co.uk" } } },
      { ...hybridConfiguration, domains: { ...hybridConfiguration.domains, entities: { hostname: `agent.${configuration.prefix}-world.test-account.workers.dev`, zoneId } } },
      { ...workersDevConfiguration, domains: { ...workersDevConfiguration.domains, operator: { ...workersDevConfiguration.domains.operator, zoneId } } },
      { ...configuration, buildImage: undefined },
      { ...configuration, domains: { ...configuration.domains, entities: undefined } },
      { ...configuration, domains: { ...configuration.domains, operator: { hostname: "console.example.co.uk" } } },
    ]) expect(stagingConfiguration.safeParse(value).success).toBe(false);
  });
  it("rejects incomplete or cross-environment inventories", () => {
    const config = stagingConfiguration.parse(configuration);
    expect(() =>
      validateInventory(config, { ...inventory(), prefix: "production" }),
    ).toThrow();
    expect(() =>
      validateInventory(config, { ...inventory(), subscriptions: {} }),
    ).toThrow();
    expect(() =>
      validateInventory(config, { ...inventory(), queues: {} }),
    ).toThrow();
  });
});

describe("Cloudflare administration boundaries", () => {
  it("never includes provider secrets in error messages", async () => {
    const request: typeof fetch = async () =>
      new Response("secret-provider-token", { status: 403 });

    const admin = new CloudflareAdmin("account-secret", accountId, request);
    await expect(
      admin.call("GET", admin.path("/queues"), resourceInventory),
    ).rejects.toThrow("HTTP 403");
  });
  it("reuses an exact push subscription without mutations", async () => {
    const methods: string[] = [];

    const request: typeof fetch = async (_url, init) => {
      methods.push(init?.method ?? "GET");

      return Response.json({
        success: true,
        result: [
          {
            id: "subscription-id",
            name: "namespace-steward-push",
            enabled: true,
            source: {
              type: "artifacts.repo",
              namespace: "namespace",
              repo_name: "steward",
            },
            destination: { type: "queues.queue", queue_id: "queue" },
            events: ["pushed"],
          },
        ],
      });
    };

    expect(
      await ensurePushSubscription(
        new CloudflareAdmin("secret", accountId, request),
        "namespace",
        "steward",
        "queue",
        true,
      ),
    ).toBe("subscription-id");
    expect(methods).toEqual(["GET"]);
  });
  it("inspect cannot create a missing subscription", async () => {
    const methods: string[] = [];

    const request: typeof fetch = async (_url, init) => {
      methods.push(init?.method ?? "GET");

      return Response.json({ success: true, result: [] });
    };

    await expect(
      ensurePushSubscription(
        new CloudflareAdmin("secret", accountId, request),
        "namespace",
        "steward",
        "queue",
        false,
      ),
    ).rejects.toThrow("Missing subscription");
    expect(methods).toEqual(["GET"]);
  });
  it("refuses existing subscription drift instead of silently replacing it", async () => {
    const request: typeof fetch = async () =>
      Response.json({
        success: true,
        result: [
          {
            id: "subscription-id",
            name: "namespace-steward-push",
            enabled: false,
            source: {
              type: "artifacts.repo",
              namespace: "namespace",
              repo_name: "steward",
            },
            destination: { type: "queues.queue", queue_id: "wrong" },
            events: ["pushed"],
          },
        ],
      });

    await expect(
      ensurePushSubscription(
        new CloudflareAdmin("secret", accountId, request),
        "namespace",
        "steward",
        "queue",
        true,
      ),
    ).rejects.toThrow("drift");
  });
});

describe("staging resource discovery", () => {
  it.each([configuration, workersDevConfiguration, hybridConfiguration])("reuses an existing account inventory without writes and verifies hosting ownership and private bucket access", async (input) => {
    const { provision } = await import("../../tooling/staging/provision");
    const config = stagingConfiguration.parse(input);
    const names = resourceNames(config);
    const methods: string[] = [];

    const request: typeof fetch = async (url, init) => {
      methods.push(init?.method ?? "GET");
      const path = new URL(String(url)).pathname;
      let result: import("../../tooling/staging/provider").JsonValue;

      if (path.endsWith("/access/organizations"))
        result = { auth_domain: config.access.teamDomain };
      else if (path.endsWith("/policies"))
        result = [
          {
            decision: "allow",
            include: [{ email: { email: config.access.operatorEmails[0] } }],
          },
        ];
      else if (path.includes("/access/apps/"))
        result = {
          domain: config.domains.operator.hostname,
          aud: config.access.audience,
          type: "self_hosted",
        };
      else if (path.endsWith("/workers/subdomain")) result = { subdomain: "test-account" };
      else if (path.startsWith("/client/v4/zones/"))
        result = {
          name: "co.uk",
          account: { id: accountId },
          status: "active",
        };
      else if (path.endsWith("/domains/managed")) result = { enabled: false };
      else if (path.endsWith("/domains/custom")) result = { domains: [] };
      else if (path.endsWith("/d1/database"))
        result = [{ uuid: inventory().databaseId, name: names.database }];
      else if (path.endsWith("/queues"))
        result = Object.entries(inventory().queues).map(
          ([queue_name, queue_id]) => ({ queue_name, queue_id }),
        );
      else if (path.endsWith("/event_subscriptions/subscriptions"))
        result = repositoryIds.map((id) => ({
          id: `${id}-subscription`,
          name: `${names.artifacts}-${id}-push`,
          enabled: true,
          source: {
            type: "artifacts.repo",
            namespace: names.artifacts,
            repo_name: id,
          },
          destination: {
            type: "queues.queue",
            queue_id: inventory().queues[names.events],
          },
          events: ["pushed"],
        }));
      else if (path.includes("/repos/"))
        result = {
          name: path.split("/").at(-1) ?? "",
          default_branch: "main",
          read_only: false,
          last_push_at: "2026-10-12T00:00:00.000Z",
        };
      else result = {};

      return Response.json({ success: true, result });
    };

    const found = await provision(
      config,
      new CloudflareAdmin("secret", accountId, request),
      true,
    );

    expect(found.databaseId).toBe(inventory().databaseId);
    expect(found.repositories).toEqual([...repositoryIds]);
    expect(methods.every((method) => method === "GET")).toBe(true);
  });
  it.each([
    { name: "another.co.uk", account: { id: "e".repeat(32) }, status: "active" },
    { name: "another.co.uk", account: { id: accountId }, status: "pending" },
    { name: "unrelated.co.uk", account: { id: accountId }, status: "active" },
  ])("rejects hybrid entity zone ownership or status drift before mutations", async (zone) => {
    const config = stagingConfiguration.parse(hybridConfiguration);
    const paths: string[] = [];
    const methods: string[] = [];

    const request: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      methods.push(init?.method ?? "GET");

      const result = path.endsWith("/access/organizations") ? { auth_domain: config.access.teamDomain }
        : path.endsWith("/policies") ? [{ decision: "allow", include: [{ email: { email: config.access.operatorEmails[0] } }] }]
        : path.includes("/access/apps/") ? { domain: config.domains.operator.hostname, aud: config.access.audience, type: "self_hosted" }
        : path.endsWith("/workers/subdomain") ? { subdomain: "test-account" }
        : zone;

      return Response.json({ success: true, result });
    };

    await expect(provision(config, new CloudflareAdmin("secret", accountId, request), false)).rejects.toThrow("configured active account");
    expect(paths.at(-2)).toContain("/workers/subdomain");
    expect(paths.at(-1)).toBe(`/client/v4/zones/${zoneId}`);
    expect(methods.every((method) => method === "GET")).toBe(true);
  });
  it("fails before resource mutations when workers.dev account ownership differs", async () => {
    const { provision } = await import("../../tooling/staging/provision");
    const config = stagingConfiguration.parse(workersDevConfiguration);
    const methods: string[] = [];

    const request: typeof fetch = async (url, init) => {
      methods.push(init?.method ?? "GET");
      const path = new URL(String(url)).pathname;

      const result = path.endsWith("/access/organizations") ? { auth_domain: config.access.teamDomain }
        : path.endsWith("/policies") ? [{ decision: "allow", include: [{ email: { email: config.access.operatorEmails[0] } }] }]
        : path.includes("/access/apps/") ? { domain: config.domains.operator.hostname, aud: config.access.audience, type: "self_hosted" }
        : { subdomain: "another-account" };

      return Response.json({ success: true, result });
    };

    await expect(provision(config, new CloudflareAdmin("secret", accountId, request), true)).rejects.toThrow("subdomain does not match");
    expect(methods).toEqual(["GET", "GET", "GET", "GET"]);
  });
  it("fails before mutations when the existing Access audience differs", async () => {
    const { provision } = await import("../../tooling/staging/provision");
    const methods: string[] = [];

    const request: typeof fetch = async (url, init) => {
      methods.push(init?.method ?? "GET");

      return Response.json({
        success: true,
        result: String(url).endsWith("/access/organizations")
          ? { auth_domain: configuration.access.teamDomain }
          : {
              domain: configuration.domains.operator.hostname,
              aud: "wrong",
              type: "self_hosted",
            },
      });
    };

    await expect(
      provision(
        stagingConfiguration.parse(configuration),
        new CloudflareAdmin("secret", accountId, request),
        true,
      ),
    ).rejects.toThrow("mismatch");
    expect(methods).toEqual(["GET", "GET"]);
  });
});
