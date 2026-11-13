import { z } from 'zod';
import { publicAuthoringScopeSchema } from '../../../../packages/contracts/src/index';

export const buildRequestSchema = z.object({ entityId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/), projectId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/).optional(), repoName: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,159}$/), commit: z.string().regex(/^[a-f0-9]{40}$/), goalId: z.string().optional(), revision: z.number().int().positive().optional(), taskId: z.string(), authoringScope: publicAuthoringScopeSchema.optional() }).strict().superRefine((request, ctx) => {
  if (Boolean(request.goalId) !== (request.revision !== undefined)) ctx.addIssue({ code: 'custom', message: 'Goal and revision must be paired' });

  if (request.goalId && (!request.authoringScope || request.authoringScope.goalId !== request.goalId || request.authoringScope.revision !== request.revision || request.authoringScope.taskId !== request.taskId || request.authoringScope.projectId !== request.projectId)) ctx.addIssue({ code: 'custom', message: 'Build needs a matching isolated public authoring scope' });

  if (request.projectId && !request.goalId) ctx.addIssue({ code: 'custom', message: 'Shared project builds require an assigned goal task' });

  if (!request.goalId && request.authoringScope) ctx.addIssue({ code: 'custom', message: 'Unexpected goal authoring scope' });
});

export type BuildRequest = z.infer<typeof buildRequestSchema>;

