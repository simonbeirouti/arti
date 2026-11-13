import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const tokens = z.record(z.string(), z.string()).parse(JSON.parse(await readFile(resolve(process.env.ARTI_DATA_ROOT ?? '.arti', 'agent-tokens.json'), 'utf8')));

const id = process.argv[2] ?? '';

if (!Object.hasOwn(tokens, id)) throw new Error('Supply an existing entity ID after starting pnpm dev');

console.log(tokens[id]);
