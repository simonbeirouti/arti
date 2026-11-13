import { readFile, readdir, stat, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { z } from 'zod';

export const capabilitySchema = z.object({
  id: z.string(), title: z.string(), owner: z.string(), code: z.array(z.string()),
  dependencies: z.array(z.string()), workflows: z.array(z.string()), guides: z.array(z.string()),
  audience: z.array(z.enum(['public', 'developer', 'agent', 'operator'])),
});

export const workflowSchema = z.object({
  id: z.string(), title: z.string(), capabilityId: z.string(), actor: z.string(),
  steps: z.array(z.string()), expectedOutcomes: z.array(z.string()), tests: z.array(z.string()),
});

const guideSchema = z.object({ id: z.string(), title: z.string(), source: z.string(), audience: z.enum(['public', 'developer', 'agent', 'operator']), workflows: z.array(z.string()) });

const verificationSchema = z.object({ guideId: z.string(), environment: z.enum(['simulation', 'staging', 'production']), publicSafe: z.boolean(), cleanup: z.literal('complete'), assertions: z.array(z.string()).min(1), sources: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)), captures: z.array(z.string()) });

export type Guide = z.infer<typeof guideSchema> & { body: string; verification: 'definition' | 'verified' | 'stale'; verificationEnvironment?: 'simulation' | 'staging' | 'production' };

export type Catalogue = { capabilities: z.infer<typeof capabilitySchema>[]; workflows: z.infer<typeof workflowSchema>[]; guides: Guide[] };

async function jsonFiles(directory: string): Promise<string[]> {
  const names = await readdir(directory);

  return names.flatMap((name) => name.endsWith('.json') ? [join(directory, name)] : []);
}

export async function loadCatalogue(root: string): Promise<Catalogue> {
  const capabilities = [];
  const workflows = [];
  const guides: Guide[] = [];

  for (const path of await jsonFiles(join(root, 'catalog/capabilities'))) capabilities.push(capabilitySchema.parse(JSON.parse(await readFile(path, 'utf8'))));

  for (const path of await jsonFiles(join(root, 'catalog/workflows'))) workflows.push(workflowSchema.parse(JSON.parse(await readFile(path, 'utf8'))));

  const definitions = z.array(guideSchema).parse(JSON.parse(await readFile(join(root, 'catalog/guides.json'), 'utf8')));

  for (const guide of definitions) {
    const path = resolve(root, guide.source);

    if (relative(root, path).startsWith('..')) throw new Error('Guide source escapes the repository');

    if ((await lstat(path)).isSymbolicLink()) throw new Error('Guide sources cannot be symbolic links');

    guides.push({ ...guide, body: await readFile(path, 'utf8'), verification: 'definition' });
  }

  const catalogue = { capabilities, workflows, guides };
  let receipts: z.infer<typeof verificationSchema>[] = [];

  try { receipts = z.array(verificationSchema).parse(JSON.parse(await readFile(join(root, 'catalog/verification.json'), 'utf8'))); } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  for (const guide of guides) {
    const receipt = receipts.find((item) => item.guideId === guide.id);

    if (!receipt) continue;
    const current = await guideFingerprints(root, catalogue, guide.id);
    const matches = Object.keys(current).length === Object.keys(receipt.sources).length && Object.entries(current).every(([path, hash]) => receipt.sources[path] === hash);
    guide.verification = matches && (guide.audience !== 'public' || receipt.publicSafe) ? 'verified' : 'stale';
    guide.verificationEnvironment = receipt.environment;
  }

  return catalogue;
}

/** Fingerprint the guide, owning capability, transitive dependencies and workflow tests. */
export async function guideFingerprints(root: string, catalogue: Catalogue, guideId: string): Promise<Record<string, string>> {
  const guide = catalogue.guides.find((item) => item.id === guideId);

  if (!guide) throw new Error('Unknown guide');
  const references = new Set([guide.source, 'catalog/guides.json']);
  const visited = new Set<string>();

  function collect(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const capability = catalogue.capabilities.find((item) => item.id === id);

    if (!capability) throw new Error('Missing capability');
    references.add(`catalog/capabilities/${id}.json`);

    for (const path of capability.code) references.add(path);

    for (const dependency of capability.dependencies) collect(dependency);
  }

  for (const capability of catalogue.capabilities) if (capability.guides.includes(guideId)) collect(capability.id);

  for (const workflow of catalogue.workflows) if (guide.workflows.includes(workflow.id)) for (const path of workflow.tests) references.add(path);
  const output: Record<string, string> = {};

  async function fingerprint(reference: string): Promise<void> {
    const path = resolve(root, reference);

    if (relative(root, path).startsWith('..')) throw new Error('Source escapes the repository');
    const info = await lstat(path);

    if (info.isSymbolicLink()) throw new Error('Catalogue sources cannot be symbolic links');

    if (info.isDirectory()) {
      for (const name of await readdir(path)) if (!['dist', 'generated', 'node_modules', '.wrangler'].includes(name)) await fingerprint(join(reference, name));
    } else output[reference] = createHash('sha256').update(await readFile(path)).digest('hex');
  }

  for (const reference of references) await fingerprint(reference);

  return output;
}

export async function validateCatalogue(root: string, catalogue: Catalogue): Promise<void> {
  const capabilities = new Set(catalogue.capabilities.map((item) => item.id));
  const workflows = new Set(catalogue.workflows.map((item) => item.id));
  const guides = new Set(catalogue.guides.map((item) => item.id));

  if (capabilities.size !== catalogue.capabilities.length || workflows.size !== catalogue.workflows.length || guides.size !== catalogue.guides.length) throw new Error('Duplicate catalogue ID');

  for (const capability of catalogue.capabilities) {
    for (const reference of capability.dependencies) if (!capabilities.has(reference)) throw new Error(`Missing capability ${reference}`);

    for (const reference of capability.workflows) if (!workflows.has(reference)) throw new Error(`Missing workflow ${reference}`);

    for (const reference of capability.guides) if (!guides.has(reference)) throw new Error(`Missing guide ${reference}`);

    for (const reference of capability.code) await stat(join(root, reference));
  }

  for (const workflow of catalogue.workflows) {
    if (!capabilities.has(workflow.capabilityId)) throw new Error(`Missing capability ${workflow.capabilityId}`);

    for (const reference of workflow.tests) await stat(join(root, reference));
  }

  for (const guide of catalogue.guides) for (const reference of guide.workflows) if (!workflows.has(reference)) throw new Error(`Missing guide workflow ${reference}`);
}

export function publicCatalogue(catalogue: Catalogue): Catalogue {
  const capabilities = catalogue.capabilities.filter((item) => item.audience.includes('public'));
  const capabilityIds = new Set(capabilities.map((item) => item.id));

  return {
    capabilities,
    workflows: catalogue.workflows.filter((item) => capabilityIds.has(item.capabilityId)),
    guides: catalogue.guides.filter((item) => item.audience === 'public'),
  };
}
