import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const localGlmConfiguration = z.strictObject({
  accountId: z.string().regex(/^[a-f0-9]{32}$/),
  dailyUsd: z.number().positive().max(1),
  activation: z.literal('ENABLE_PAID_LOCAL_GLM'),
});

export type LocalGlmConfiguration = z.infer<typeof localGlmConfiguration>;

export async function readLocalGlmConfiguration(path: string): Promise<LocalGlmConfiguration> {
  return localGlmConfiguration.parse(JSON.parse(await readFile(path, 'utf8')));
}
