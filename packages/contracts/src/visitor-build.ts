import { z } from 'zod';
import type { Deployment, Discussion, Entity, SharedProject, WorldEvent } from './index';

export const visitorSchema = z.object({ id: z.string().min(1), name: z.string().trim().min(1).max(60) }).strict();

export type Visitor = z.infer<typeof visitorSchema>;

export const suggestionVoteSchema = z.object({ entityId: z.string(), approved: z.boolean(), usefulness: z.number().int().min(0).max(5), fit: z.number().int().min(0).max(5), feasibility: z.number().int().min(0).max(5), reason: z.string().trim().min(5).max(1000) }).strict();

export type SuggestionVote = z.infer<typeof suggestionVoteSchema>;

export const suggestionReviewSchema = z.object({ brief: z.string().trim().max(4000), criteria: z.array(z.string().trim().min(3).max(500)).max(12), reason: z.string().trim().min(5).max(1000), duplicateOf: z.string().optional() }).strict();

export const suggestionSchema = z.object({ id: z.string(), visitorId: z.string(), visitorName: z.string(), text: z.string().trim().min(10).max(2000), createdAt: z.iso.datetime(), status: z.enum(['pending', 'reviewing', 'eligible', 'rejected', 'duplicate', 'selected', 'completed']), review: suggestionReviewSchema.optional(), votes: z.array(suggestionVoteSchema).max(3), goalId: z.string().optional() }).strict();

export type Suggestion = z.infer<typeof suggestionSchema>;

export const reviewObservationSchema = z.object({ id: z.string(), goalId: z.string(), revision: z.number().int().positive(), deploymentId: z.string(), commit: z.string(), reviewerId: z.string(), createdAt: z.iso.datetime(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), environment: z.enum(['simulation', 'staging', 'production']) }).strict();

export type ReviewObservation = z.infer<typeof reviewObservationSchema>;

export const visitorBuildStateSchema = z.object({ sharedOnly: z.boolean().optional(), blockers: z.array(z.object({ goalId: z.string(), revision: z.number().int().positive(), reason: z.string(), createdAt: z.iso.datetime() }).strict()).default([]), observations: z.array(reviewObservationSchema).default([]), visitors: z.array(visitorSchema), suggestions: z.array(suggestionSchema), submissions: z.array(z.object({ visitorId: z.string(), ipHash: z.string(), createdAt: z.iso.datetime(), key: z.string(), fingerprint: z.string(), suggestionId: z.string() }).strict()).default([]) }).strict();

export type VisitorBuildState = z.infer<typeof visitorBuildStateSchema>;

export type PublicBuild = { mode: 'simulation' | 'live'; paused: boolean; projects: SharedProject[]; entities: Entity[]; suggestions: Suggestion[]; discussions: Discussion[]; events: WorldEvent[]; deployments: Deployment[]; currentGoal: { id: string; revision: number; title: string; suggestionId: string; visitorName: string; status: string; blocker?: string; tasks: { id: string; entityId: string; status: string; title: string }[] } | null };

const suggestionId = z.string().min(1).max(200);

const revision = z.number().int().positive();

const assertion = z.string().trim().min(5).max(500);

export const suggestionCommandSchemas = [
  z.object({ type: z.literal('suggestion.review'), suggestionId, ...suggestionReviewSchema.shape, rejected: z.boolean() }).strict(),
  z.object({ type: z.literal('suggestion.vote'), suggestionId, approved: z.boolean(), usefulness: suggestionVoteSchema.shape.usefulness, fit: suggestionVoteSchema.shape.fit, feasibility: suggestionVoteSchema.shape.feasibility, reason: suggestionVoteSchema.shape.reason }).strict(),
  z.object({ type: z.literal('suggestion.select') }).strict(),
  z.object({ type: z.literal('suggestion.task_review'), taskId: z.string(), expectedRevision: revision, approved: z.boolean(), feedback: z.string().trim().min(5).max(1000), evidenceIds: z.array(z.string()).max(20) }).strict(),
  z.object({ type: z.literal('suggestion.verify'), goalId: z.string(), expectedRevision: revision, criterionIndex: z.number().int().nonnegative(), deploymentId: z.string(), observationId: z.string().min(1), assertions: z.array(assertion).min(1).max(20) }).strict(),
  z.object({ type: z.literal('suggestion.complete'), goalId: z.string(), expectedRevision: revision }).strict(),
] as const;

export type SuggestionCommand = z.infer<(typeof suggestionCommandSchemas)[number]>;
