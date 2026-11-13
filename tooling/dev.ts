import { resolve } from 'node:path';
import { createServer } from 'vite';
import { startServers } from './server';
import { readLocalGlmConfiguration } from './features/local-glm/configuration';
import { validateWorldSource } from './features/live-view/live-view';

const root = process.cwd();

const localGlm = process.argv.includes('--local-glm') ? await readLocalGlmConfiguration(process.env.ARTI_LOCAL_GLM_CONFIG ?? '.arti/local-glm.json') : undefined;

const dataRoot = resolve(process.env.ARTI_DATA_ROOT ?? (localGlm ? '.arti/local-glm-world' : '.arti'));

const tick = Number(process.env.ARTI_AUTOTICK_MS ?? '2000');

if (!Number.isFinite(tick) || tick < 0) throw new Error('Invalid simulation tick interval');

const worldSource = validateWorldSource(process.env.ARTI_WORLD_SOURCE);

if (worldSource && localGlm) throw new Error('Choose local GLM or remote public observation');

const backend = worldSource ? undefined : await startServers(root, dataRoot, tick, undefined, localGlm);

const frontend = await createServer({ configFile: resolve(root, 'apps/console/vite.config.ts') });

await frontend.listen();

if (worldSource) {
  console.log(`Arti live public view: http://localhost:5173/world · source ${worldSource}`);
  console.log('Cloudflare public data and visitor suggestions. No local agents or simulated ticks; live controls remain deployed.');
} else {
  console.log(localGlm ? `Arti local GLM: http://localhost:5173 · real inference · $${localGlm.dailyUsd}/day · previews stay local` : 'Arti simulation: http://localhost:5173 · public world /world · knowledge http://localhost:4174');

  if (!localGlm) console.log('Paid activity is disabled.');
}

async function close(): Promise<void> {
  await frontend.close();
  await backend?.close();
  process.exit(0);
}

process.on('SIGINT', () => { void close(); });

process.on('SIGTERM', () => { void close(); });
