import { isIP } from "node:net";
import { getDomain } from "tldts";
import { z } from "zod";

export const entityIds = [
  "steward",
  "moderator",
  "builder-1",
  "builder-2",
  "builder-3",
  "builder-4",
  "researcher",
  "archivist",
] as const;

export const repositoryIds = [...entityIds, "collective"] as const;

const accountId = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .refine(
    (value) => !/^0+$/.test(value),
    "Replace placeholder account/zone ID",
  );

const hostname = z
  .string()
  .toLowerCase()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/)
  .refine(
    (value) =>
      !isIP(value) && !!getDomain(value, { allowPrivateDomains: true }),
    "Use a public DNS hostname",
  );

const domain = z.object({ hostname, zoneId: accountId.optional() }).strict();

const allowance = z.number().finite().min(0).max(1000);

export const stagingConfiguration = z
  .object({
    schemaVersion: z.literal(1),
    environment: z.literal("staging"),
    prefix: z.string().regex(/^[a-z][a-z0-9-]{2,25}-staging$/),
    accountId,
    hosting: z.enum(["custom-domains", "workers-dev"]).default("custom-domains"),
    workersDevSubdomain: z.string().regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/).optional(),
    domains: z
      .object({ operator: domain, entities: domain.optional(), knowledge: domain })
      .strict(),
    access: z
      .object({
        teamDomain: z.string().regex(/^[a-z0-9-]+\.cloudflareaccess\.com$/),
        applicationId: z.uuid(),
        audience: z.string().regex(/^[a-f0-9]{64}$/),
        operatorEmails: z.array(z.email()).min(1),
      })
      .strict(),
    approvedResearchHosts: z.array(hostname),
    quotas: z
      .object({
        dailyUsd: allowance,
        entityDailyUsd: z.record(z.enum(entityIds), allowance),
        maxConcurrentBuilds: z.literal(2),
      })
      .strict(),
    buildImage: z
      .string()
      .regex(
        /^registry\.cloudflare\.com\/[a-f0-9]{32}\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/,
      ).optional(),
  })
  .strict()
  .superRefine((config, context) => {
    const trusted = getDomain(config.domains.operator.hostname, {
      allowPrivateDomains: true,
    });

    const untrusted = config.domains.entities && getDomain(config.domains.entities.hostname, {
      allowPrivateDomains: true,
    });

    const knowledge = getDomain(config.domains.knowledge.hostname, {
      allowPrivateDomains: true,
    });

    if (untrusted && (trusted === untrusted || knowledge === untrusted))
      context.addIssue({
        code: "custom",
        path: ["domains"],
        message:
          "Entity sites require a separate registrable domain from operator and knowledge sites",
      });

    if (config.domains.operator.hostname === config.domains.knowledge.hostname)
      context.addIssue({
        code: "custom",
        path: ["domains"],
        message: "Operator and knowledge hosts must differ",
      });

    if (config.buildImage && (
      !config.buildImage.startsWith(
        `registry.cloudflare.com/${config.accountId}/`,
      ) ||
      /sha256:0+$/.test(config.buildImage)
    ))
      context.addIssue({
        code: "custom",
        path: ["buildImage"],
        message: "Pin a non-placeholder image digest in this account",
      });

    if (config.hosting === "custom-domains") {
      if (!config.domains.entities || !config.buildImage)
        context.addIssue({ code: "custom", path: ["domains"], message: "Custom-domain release requires entity hosting and a pinned build image" });

      for (const [name, value] of Object.entries(config.domains))
        if (!value?.zoneId) context.addIssue({ code: "custom", path: ["domains", name, "zoneId"], message: "Custom domains require active zone IDs" });

      if (config.workersDevSubdomain) context.addIssue({ code: "custom", path: ["workersDevSubdomain"], message: "workers.dev subdomain is only valid in workers-dev mode" });
    } else {
      const suffix = `${config.workersDevSubdomain}.workers.dev`;

      if (!config.workersDevSubdomain || config.domains.operator.hostname !== `${config.prefix}-world.${suffix}` || config.domains.knowledge.hostname !== `${config.prefix}.${suffix}`)
        context.addIssue({ code: "custom", path: ["domains"], message: "workers.dev hosts must exactly match the configured Worker names and account subdomain" });

      if (config.domains.entities && (!config.domains.entities.zoneId || !config.buildImage))
        context.addIssue({ code: "custom", path: ["domains", "entities"], message: "Independent entity hosting requires an active zone ID and a pinned build image" });

      if (config.domains.operator.zoneId || config.domains.knowledge.zoneId)
        context.addIssue({ code: "custom", path: ["domains"], message: "workers.dev hosts do not use zone IDs" });
    }

    for (const host of config.approvedResearchHosts)
      if (
        host.endsWith(".localhost") ||
        host.endsWith(".internal") ||
        host.endsWith(".invalid")
      )
        context.addIssue({
          code: "custom",
          path: ["approvedResearchHosts"],
          message: "Research hosts must be approved public hosts",
        });
  });

export type StagingConfiguration = z.infer<typeof stagingConfiguration>;

export const resourceInventory = z
  .object({
    schemaVersion: z.literal(1),
    environment: z.literal("staging"),
    accountId,
    prefix: z.string(),
    checkedAt: z.iso.datetime(),
    accessVerified: z.literal(true),
    databaseId: z.uuid(),
    queues: z.record(z.string(), z.string().min(1)),
    repositories: z.array(z.enum(repositoryIds)),
    subscriptions: z.record(z.string(), z.string().min(1)),
  })
  .strict();

export type ResourceInventory = z.infer<typeof resourceInventory>;

export function resourceNames(config: StagingConfiguration) {
  const p = config.prefix;

  return {
    world: `${p}-world`,
    agent: `${p}-agent-runtime`,
    execution: `${p}-execution`,
    knowledge: config.hosting === "workers-dev" ? p : `${p}-knowledge`,
    artifacts: `${p}-artifacts`,
    staging: `${p}-preview`,
    production: `${p}-production`,
    builds: `${p}-private-builds`,
    backups: `${p}-private-backups`,
    projections: `${p}-public-projections`,
    projectionDead: `${p}-public-projections-dead`,
    events: `${p}-artifact-events`,
    dead: `${p}-artifact-events-dead`,
    database: `${p}-public-index`,
    publication: `${p}-publication`,
    outbound: `${p}-generated-outbound`,
  };
}

export function validateInventory(
  config: StagingConfiguration,
  inventory: ResourceInventory,
) {
  const n = resourceNames(config);

  if (
    inventory.accountId !== config.accountId ||
    inventory.prefix !== config.prefix
  )
    throw new Error("Inventory account/environment differs from configuration");

  for (const name of [n.projections, n.projectionDead, n.events, n.dead])
    if (!inventory.queues[name])
      throw new Error(`Inventory missing queue ${name}`);

  for (const id of repositoryIds)
    if (!inventory.repositories.includes(id) || !inventory.subscriptions[id])
      throw new Error(`Inventory missing repository/subscription ${id}`);
}
