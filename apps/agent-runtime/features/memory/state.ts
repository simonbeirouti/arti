import { z } from 'zod';
import { commandSchema, publicAuthoringScopeSchema } from '../../../../packages/contracts/src/index';
import { turnContinuationSchema } from '../agent-turns/continuation';

export const privateStateSchema = z.object({
  entries: z.array(z.string().max(10000)).max(50), running: z.boolean(), turns: z.number().int().nonnegative(), leaseUntil: z.number().nonnegative(), checkpoint: z.number().int().nonnegative(), turnId: z.string().nullable(), pendingCommand: z.object({ command: commandSchema, key: z.string().max(200), scope: z.enum(['private', 'public']).optional(), authoringScope: publicAuthoringScopeSchema.optional() }).nullable(),
  governancePending: z.object({ command: commandSchema, key: z.string().max(200) }).nullable().optional(),
  continuation: turnContinuationSchema.nullable().optional(),
});

export const privateSnapshotSchema = z.object({ entityId: z.string().min(1), state: privateStateSchema });

export type PrivateSnapshot = z.infer<typeof privateSnapshotSchema>;
