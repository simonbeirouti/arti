import { createHash } from 'node:crypto';
import { resolve } from "node:path";
import {
  repositoryIds,
  resourceNames,
  validateInventory,
  type ResourceInventory,
  type StagingConfiguration,
} from "./configuration";

export function generateConfigurations(
  config: StagingConfiguration,
  inventory: ResourceInventory,
  root: string,
) {
  validateInventory(config, inventory);
  const n = resourceNames(config);
  const backupEnvironment = `${config.prefix}:${createHash('sha256').update(JSON.stringify({ accountId: config.accountId, prefix: config.prefix, domains: config.domains, resources: n })).digest('hex')}`;

  const base = {
    account_id: config.accountId,
    compatibility_date: "2026-10-12",
    workers_dev: false,
    preview_urls: false,
    observability: { enabled: true },
  };

  const worldBinding = {
    name: "WORLD",
    class_name: "WorldDurableObject",
    script_name: n.world,
  };

  const execution = {
    binding: "EXECUTION",
    service: n.execution,
    entrypoint: "ExecutionGateway",
  };

  const disabled = {
    LIVE_ACTIVATED: "false",
    MODEL_EVALUATED: "false",
    DAILY_ALLOWANCE_USD: "0",
    EVALUATIONS_ENABLED: "false",
    EVALUATION_ALLOWANCE_USD: "0",
    BACKUP_ALLOWANCE_USD: "0",
    BACKUPS_ENABLED: "false",
    ALERTS_ENABLED: "false",
    ALERT_DELIVERY_AUTHORIZED: "false",
    ENVIRONMENT_NAME: `${config.prefix}:${config.accountId}`,
    MODEL_EVALUATION_ID: "",
  };

  return {
    world: {
      ...base,
      name: n.world,
      workers_dev: config.hosting === "workers-dev",
      main: resolve(root, "apps/world/src/index.ts"),
      compatibility_flags: ["nodejs_compat"],
      assets: {
        directory: resolve(root, "apps/console/dist"),
        binding: "ASSETS",
        not_found_handling: "single-page-application",
        run_worker_first: ["/api/*"],
      },
      vars: {
        ...disabled,
        AUTO_SIMULATION_TICKS: "false",
        BACKUPS_ENABLED: "false",
        BACKUP_ENVIRONMENT: backupEnvironment,
        ACCESS_TEAM_DOMAIN: config.access.teamDomain,
        ACCESS_AUDIENCE: config.access.audience,
        OPERATOR_EMAILS: config.access.operatorEmails.join(","),
        OPERATOR_ORIGIN: `https://${config.domains.operator.hostname}`,
        ENTITY_DOMAIN: config.domains.entities?.hostname ?? "",
        PUBLICATION_ENABLED: "false",
      },
      ai: { binding: "AI" },
      routes: [
        ...(config.hosting === "custom-domains" ? [{ pattern: config.domains.operator.hostname, custom_domain: true }] : []),
      ],
      services: [execution],
      durable_objects: {
        code_update_strategy: { mode: "immediate" },
        bindings: [
          { name: "WORLD", class_name: "WorldDurableObject" },
          {
            name: "ENTITY_AGENT",
            class_name: "EntityAgent",
            script_name: n.agent,
          },
        ],
      },
      migrations: [{ tag: "v1", new_sqlite_classes: ["WorldDurableObject"] }],
      d1_databases: [
        {
          binding: "PUBLIC_INDEX",
          database_name: n.database,
          database_id: inventory.databaseId,
          migrations_dir: resolve(root, "infrastructure/migrations"),
        },
      ],
      r2_buckets: [
        { binding: "WORLD_BACKUPS", bucket_name: n.backups },
        { binding: "WORLD_BUILDS", bucket_name: n.builds },
      ],
      queues: {
        producers: [{ binding: "PROJECTIONS", queue: n.projections }],
        consumers: [
          { queue: n.projections, max_batch_size: 20, max_retries: 5, dead_letter_queue: n.projectionDead },
          { queue: n.projectionDead, max_batch_size: 20 },
        ],
      },
      triggers: { crons: ["* * * * *"] },
    },
    agent: {
      ...base,
      name: n.agent,
      main: resolve(root, "apps/agent-runtime/src/worker.ts"),
      compatibility_flags: ["nodejs_compat"],
      vars: disabled,
      ai: { binding: "AI" },
      services: [execution],
      durable_objects: {
        code_update_strategy: { mode: "immediate" },
        bindings: [
          { name: "ENTITY_AGENT", class_name: "EntityAgent" },
          worldBinding,
        ],
      },
      migrations: [{ tag: "v1", new_sqlite_classes: ["EntityAgent"] }],
    },
    execution: {
      ...base,
      name: n.execution,
      main: resolve(root, "apps/execution/src/index.ts"),
      compatibility_flags: ["nodejs_compat"],
      vars: {
        ...disabled,
        CLOUDFLARE_ACCOUNT_ID: config.accountId,
        ARTIFACTS_NAMESPACE: n.artifacts,
        STAGING_NAMESPACE: n.staging,
        PRODUCTION_NAMESPACE: n.production,
        ENTITY_DOMAIN: config.domains.entities?.hostname ?? "",
        PUBLICATION_ENABLED: "false",
        RESEARCH_ALLOWED_HOSTS: config.approvedResearchHosts.join(","),
      },
      browser: { binding: "BROWSER" },
      triggers: { crons: ["* * * * *"] },
      routes: config.domains.entities ? repositoryIds.flatMap(entityId => [
        {
          pattern: `${entityId}.${config.domains.entities?.hostname}`,
          custom_domain: true,
          zone_id: config.domains.entities?.zoneId,
        },
        {
          pattern: `${entityId}.${config.domains.entities?.hostname}/*`,
          zone_id: config.domains.entities?.zoneId,
        },
      ]) : [],
      artifacts: [{ binding: "ARTIFACTS", namespace: n.artifacts }],
      containers: config.buildImage ? [
        {
          class_name: "BuildSandbox",
          scheduling_policy: "durable_object",
          images: { build: { image: config.buildImage } },
        },
      ] : [],
      durable_objects: {
        code_update_strategy: { mode: "immediate" },
        bindings: [
          { name: "APP_DATA", class_name: "ApplicationStore" },
          ...(config.buildImage ? [{ name: "BUILD_SANDBOX", class_name: "BuildSandbox" }] : []),
          worldBinding,
        ],
      },
      migrations: [
        { tag: "v1", new_sqlite_classes: ["BuildSandbox"] },
        { tag: "v2", new_sqlite_classes: ["ApplicationStore"] },
      ],
      workflows: [
        {
          name: n.publication,
          binding: "PUBLICATION",
          class_name: "PublicationWorkflow",
        },
      ],
      queues: {
        consumers: [
          {
            queue: n.events,
            max_batch_size: 1,
            max_concurrency: 2,
            dead_letter_queue: n.dead,
          },
          { queue: n.dead, max_batch_size: 20 },
        ],
      },
      r2_buckets: [{ binding: "BUILDS", bucket_name: n.builds }],
      dispatch_namespaces: [
        {
          binding: "DISPATCH",
          namespace: n.production,
          outbound: { service: n.outbound },
        },
        {
          binding: "STAGING",
          namespace: n.staging,
          outbound: { service: n.outbound },
        },
      ],
    },
    outbound: {
      ...base,
      name: n.outbound,
      main: resolve(
        root,
        "apps/execution/features/application-services/outbound.ts",
      ),
    },
    knowledge: {
      ...base,
      name: n.knowledge,
      vars: { PUBLIC_WORLD_HOME: config.hosting === "workers-dev" ? "true" : "false" },
      workers_dev: config.hosting === "workers-dev",
      services: [{ binding: "WORLD", service: n.world }],
      main: resolve(root, "apps/knowledge/src/index.ts"),
      routes: [
        ...(config.hosting === "custom-domains" ? [{ pattern: config.domains.knowledge.hostname, custom_domain: true }] : []),
      ],
      assets: {
        directory: resolve(root, "apps/knowledge/dist"),
        binding: "ASSETS",
        run_worker_first: true,
      },
    },
  };
}
