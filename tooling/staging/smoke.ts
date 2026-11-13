import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stagingConfiguration } from './configuration';
import { z } from 'zod';

const file = process.argv[2];

if (!file) throw new Error('Usage: staging:smoke staging.local.json');

const config = stagingConfiguration.parse(JSON.parse(await readFile(file, 'utf8')));

const publicOrigin = `https://${config.domains.knowledge.hostname}`;

const operatorOrigin = `https://${config.domains.operator.hostname}`;

const checks: { id: string; passed: boolean }[] = [];

const get = (url: string, headers?: Record<string, string>) => fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });

async function check(id: string, action: () => Promise<boolean>) {
  try { checks.push({ id, passed: await action() }); } catch { checks.push({ id, passed: false }); }
}

await check('public-world-projection', async () => {
  const response = await get(`${publicOrigin}/api/v1/public/world`);
  const payload = z.record(z.string(), z.json()).parse(await response.json());
  const value = z.object({ entities: z.array(z.object({ id: z.string() })) }).parse(payload);
  const keys = Object.keys(payload);

  return response.ok && value.entities.length === 6 && !keys.some(key => ['goals', 'tasks', 'receipts', 'confirmations', 'reservations'].includes(key));
});

await check('public-map', async () => {
  const response = await get(`${publicOrigin}/world`);

  return response.ok && (response.headers.get('Content-Type') ?? '').includes('text/html') && !response.headers.has('Set-Cookie');
});

await check('public-private-route-denied', async () => (await get(`${publicOrigin}/api/v1/world`)).status === 404);

await check('operator-anonymous-denied', async () => [302, 303, 401, 403].includes((await get(`${operatorOrigin}/api/v1/world`)).status));

const assertion = process.env.ARTI_ACCESS_JWT;

if (assertion) await check('operator-authenticated-operations', async () => {
  const response = await get(`${operatorOrigin}/api/v1/operations`, { 'Cf-Access-Jwt-Assertion': assertion, Cookie: `CF_Authorization=${assertion}` });

  return response.ok && response.headers.get('Cache-Control') === 'no-store';
});

const directory = resolve('.arti/staging', config.prefix);

await mkdir(directory, { recursive: true });

const receipt = { environment: 'cloud-staging', accountId: config.accountId, prefix: config.prefix, checkedAt: new Date().toISOString(), readOnly: true, paidInferenceDispatched: false, checks, passed: checks.every(item => item.passed), coverage: 'HTTP routing and access only; provider execution and real goal journey require separate receipts' };

await writeFile(resolve(directory, 'http-smoke.json'), JSON.stringify(receipt, null, 2));

console.log(JSON.stringify(receipt, null, 2));

process.exitCode = receipt.passed ? 0 : 1;
