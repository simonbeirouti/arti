import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadCatalogue, validateCatalogue } from '../apps/knowledge/src/catalog';
import { releaseFingerprint } from '../apps/world/generated/release';

const root = process.cwd();

const catalogue = await loadCatalogue(root);

await validateCatalogue(root, catalogue);

const workflow = catalogue.workflows.find(item => item.id === process.argv[2]);

if (!workflow || !workflow.tests.length) throw new Error('Provide a catalogue workflow ID with executable tests');

const groups = [
  { config: undefined, tests: workflow.tests.filter(path => !path.startsWith('tests/workers/') && !path.endsWith('.worker.ts')) },
  { config: 'vitest.workers.config.ts', tests: workflow.tests.filter(path => path.startsWith('tests/workers/')) },
  { config: 'apps/execution/vitest.workers.config.ts', tests: workflow.tests.filter(path => path.endsWith('.worker.ts')) },
];

let passed = true;

for (const group of groups) {
  if (!group.tests.length) continue;
  const args = ['exec', 'vitest', 'run', ...(group.config ? ['--config', group.config] : []), ...group.tests];

  const code = await new Promise<number | null>((accept, reject) => {
    const child = spawn('pnpm', args, { cwd: root, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('exit', accept);
  });

  passed &&= code === 0;
}

const directory = resolve(root, '.arti/walkthroughs');

await mkdir(directory, { recursive: true });

const path = resolve(directory, `${workflow.id}-${Date.now()}.json`);

await writeFile(path, JSON.stringify({ workflowId: workflow.id, environment: 'simulation', cloudVerified: false, releaseFingerprint, passed, assertions: workflow.expectedOutcomes, tests: workflow.tests, completedAt: new Date().toISOString(), cleanup: 'Provider resources were not created by this runner' }, null, 2));

console.log(`Private local walkthrough receipt: ${path}`);

process.exitCode = passed ? 0 : 1;
