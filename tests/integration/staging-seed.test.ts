import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { stagingConfiguration } from '../../tooling/staging/configuration';
import { CloudflareAdmin } from '../../tooling/staging/provider';
import { prepareRepositorySeed, seedRepositories, seedCanonicalRepositories } from '../../tooling/staging/seed';

it('prepares a distinct collective starter while retaining the trusted storage capability and matched starter tests', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'arti-collective-seed-'));

  try {
    await prepareRepositorySeed(process.cwd(), cwd, 'collective');
    expect(JSON.parse(await readFile(join(cwd, 'project.json'), 'utf8'))).toEqual({ id: 'collective', name: 'Arti collective', repository: 'collective', schemaVersion: 1 });
    const worker = await readFile(join(cwd, 'site/worker.ts'), 'utf8');
    expect(worker).toContain('One shared website');
    expect(worker).toContain('not evidence of completed autonomous work');
    expect(worker).toContain('Trusted scheduled invocation required');
    expect(await readFile(join(cwd, 'tests/worker.test.mjs'), 'utf8')).toContain('One shared website');
    expect(JSON.parse(await readFile(join(cwd, 'entity.json'), 'utf8')).id).toBe('collective');
    const execute = promisify(execFile);
    await execute(process.execPath, [join(process.cwd(), 'node_modules/typescript/bin/tsc'), join(cwd, 'site/worker.ts'), '--ignoreConfig', '--target', 'ES2023', '--module', 'ESNext', '--skipLibCheck', '--outDir', join(cwd, 'tests/output')]);
    await execute(process.execPath, ['--test', join(cwd, 'tests/worker.test.mjs')]);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

it('preserves all existing repository histories including collective without issuing a write token', async () => {
  const accountId = 'a'.repeat(32);
  const config = stagingConfiguration.parse({ schemaVersion: 1, environment: 'staging', prefix: 'arti-test-staging', accountId, hosting: 'workers-dev', workersDevSubdomain: 'test-account', domains: { operator: { hostname: 'arti-test-staging-world.test-account.workers.dev' }, knowledge: { hostname: 'arti-test-staging.test-account.workers.dev' } }, access: { applicationId: '10000000-0000-4000-8000-000000000001', teamDomain: 'arti.cloudflareaccess.com', audience: 'b'.repeat(64), operatorEmails: ['operator@example.com'] }, approvedResearchHosts: [], quotas: { dailyUsd: 0, entityDailyUsd: { steward: 0, moderator: 0, 'builder-1': 0, 'builder-2': 0, 'builder-3': 0, 'builder-4': 0, researcher: 0, archivist: 0 }, maxConcurrentBuilds: 2 } });
  const paths: string[] = [];

  const request: typeof fetch = async (url, init) => {
    expect(init?.method).toBe('GET');
    const path = new URL(String(url)).pathname;
    paths.push(path);

    return Response.json({ success: true, result: { name: path.split('/').at(-1), default_branch: 'main', read_only: false, last_push_at: '2026-10-17T00:00:00.000Z' } });
  };

  expect(await seedRepositories(config, new CloudflareAdmin('secret', accountId, request), process.cwd())).toEqual([]);
  expect(paths).toHaveLength(9);
  expect(paths.at(-1)).toContain('/repos/collective');
});


it('seeds only explicitly selected repository IDs in the matching inspected account', async () => {
  const accountId = 'a'.repeat(32);
  const paths: string[] = [];

  const request: typeof fetch = async (url, init) => {
    expect(init?.method).toBe('GET');
    const path = new URL(String(url)).pathname;
    paths.push(path);

    return Response.json({ success: true, result: { name: path.split('/').at(-1), default_branch: 'main', read_only: false, last_push_at: '2026-10-17T00:00:00.000Z' } });
  };

  const admin = new CloudflareAdmin('secret', accountId, request);
  expect(await seedCanonicalRepositories(admin, 'existing-artifacts', accountId, process.cwd(), ['builder-3', 'builder-4', 'collective'])).toEqual([]);
  expect(paths.map(path => path.split('/').at(-1))).toEqual(['builder-3', 'builder-4', 'collective']);
  const count = paths.length;
  await expect(seedCanonicalRepositories(admin, 'existing-artifacts', 'b'.repeat(32), process.cwd(), ['collective'])).rejects.toThrow('mismatch');
  await expect(seedCanonicalRepositories(admin, '../escape', accountId, process.cwd(), ['collective'])).rejects.toThrow();
  await expect(seedCanonicalRepositories(admin, 'existing-artifacts', accountId, process.cwd(), ['collective', 'collective'])).rejects.toThrow('mismatch');
  expect(paths).toHaveLength(count);
});
