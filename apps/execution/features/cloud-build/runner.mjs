import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const workspace = process.env.ARTI_BUILD_ROOT ?? '/workspace';

const compilerRoot = process.env.ARTI_COMPILER_ROOT ?? '/compiler';

let input = '';

for await (const chunk of process.stdin) input += chunk;

const source = JSON.parse(input);

await mkdir(workspace, { recursive: true });

await writeFile(`${workspace}/worker.ts`, source.worker);

await writeFile(`${workspace}/package.json`, '{"type":"module"}');

await writeFile(`${workspace}/worker.test.mjs`, source.tests);

const compiler = spawnSync(process.execPath, [`${compilerRoot}/node_modules/typescript/bin/tsc`, '--ignoreConfig', '--target', 'ES2023', '--module', 'ESNext', '--lib', 'ES2023,DOM', '--strict', '--skipLibCheck', '--outDir', `${workspace}/output`, `${workspace}/worker.ts`], { encoding: 'utf8', timeout: 60000, env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, maxBuffer: 1048576 });

if (compiler.status !== 0) throw new Error(`Compilation failed: ${compiler.stdout}\n${compiler.stderr}`);

const tests = spawnSync(process.execPath, ['--test', `${workspace}/worker.test.mjs`], { encoding: 'utf8', timeout: 60000, env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, cwd: workspace, maxBuffer: 1048576 });

if (tests.status !== 0) throw new Error(`Tests failed: ${tests.stdout}\n${tests.stderr}`);

const compiled = await readFile(`${workspace}/output/worker.js`, 'utf8');

// Smoke-check the exact output after agent-authored tests have finished.
await writeFile(`${workspace}/output/check.mjs`, `import worker from './worker.js';const response=await worker.fetch(new Request('https://entity.invalid/'),{});if(!(response instanceof Response)||response.status>=500)throw new Error('Worker smoke failed');`);

const smoke = spawnSync(process.execPath, [`${workspace}/output/check.mjs`], { encoding: 'utf8', timeout: 10000, env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, maxBuffer: 1048576 });

if (smoke.status !== 0) throw new Error(`Smoke failed: ${smoke.stderr}`);

process.stdout.write(JSON.stringify({ compiled, assertions: ['TypeScript compiled', 'Agent tests passed', 'Independent HTTP smoke passed'] }));
