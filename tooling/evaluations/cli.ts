import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stagingConfiguration } from '../staging/configuration';

const [command, file, acknowledgement] = process.argv.slice(2);

if (!file || !['list', 'run'].includes(command)) throw new Error('Usage: evaluations <list|run> staging.json [RUN_PAID_MODEL_EVALUATION]');

const configuration = stagingConfiguration.parse(JSON.parse(await readFile(file, 'utf8')));

const origin = `https://${configuration.domains.operator.hostname}`;

const assertion = process.env.ARTI_ACCESS_JWT;

if (!assertion) throw new Error('Set ARTI_ACCESS_JWT privately in your shell; never commit it');

if (command === 'run' && acknowledgement !== 'RUN_PAID_MODEL_EVALUATION') throw new Error('Paid evaluation requires explicit RUN_PAID_MODEL_EVALUATION argument and server allowance configuration');

const response = await fetch(`${origin}/api/v1/evaluations`, {
  method: command === 'run' ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(240_000),
  headers: { Origin: origin, 'Cf-Access-Jwt-Assertion': assertion, Cookie: `CF_Authorization=${assertion}`, 'Content-Type': 'application/json' },
  body: command === 'run' ? JSON.stringify({ id: randomUUID(), allowanceUsd: 0.1, acknowledge: acknowledgement }) : undefined,
});

if (!response.ok) throw new Error(`Evaluation rejected (HTTP ${response.status}); inspect operator configuration`);

console.log(JSON.stringify(await response.json(), null, 2));
