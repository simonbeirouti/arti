import { z } from 'zod';
import { publicAuthoringScopeSchema, type PublicAuthoringScope } from '../../../../packages/contracts/src/index';
import { personalProgressSchema } from './personal-progress';
import { sliceStateSchema } from './slices';

export const turnContinuationSchema = z.object({
  id: z.string().uuid(), release: z.string().regex(/^[a-f0-9]{64}$/), context: z.string().max(20_000), privateWork: z.boolean(), instructions: z.string().max(100_000),
  profile: z.object({ id: z.string().max(100), name: z.string().max(100), role: z.string().max(100), personality: z.array(z.string().max(1000)).max(30) }).strict(),
  authoringScope: publicAuthoringScopeSchema.optional(), personal: personalProgressSchema.nullable(), slice: sliceStateSchema,
}).strict().superRefine((value, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 256_000) ctx.addIssue({ code: 'custom', message: 'Continuation exceeds durable session byte allowance' });
});

export type TurnContinuation = z.infer<typeof turnContinuationSchema>;

export interface ContinuationContext {
  entityId: string;
  siteVersion: number;
  privateWork: boolean;
  goals: { id: string; revision: number; status: string }[];
  assignment: { id: string; goalId: string; revision: number } | null;
  authoringScope?: PublicAuthoringScope;
}

/** Only server-derived scope identifies a continuation. Private/public histories never migrate. */
export function continuationContext(input: ContinuationContext): string {
  return JSON.stringify({ entityId: input.entityId, siteVersion: input.siteVersion, privateWork: input.privateWork, goals: input.goals, assignment: input.assignment, authoringScope: input.authoringScope });
}

export function continuationMatches(saved: TurnContinuation, context: string, release: string): boolean { return saved.context === context && saved.release === release; }

/** Admission checks happen before dispatch; retained private memory is never silently trimmed. */
export function requireStateStorage(serialized: string): void {
  if (new TextEncoder().encode(serialized).byteLength > 1_800_000) throw new Error('Agent state exceeds durable byte allowance');
}
