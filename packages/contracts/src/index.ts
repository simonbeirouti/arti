import { z } from 'zod';
import { suggestionCommandSchemas, type VisitorBuildState } from './visitor-build';

export const goalStatusSchema = z.enum(['draft', 'active', 'awaiting_acceptance', 'completed', 'paused', 'blocked', 'cancelled']);

export type GoalStatus = z.infer<typeof goalStatusSchema>;

export type Actor = { role: 'operator' | 'entity' | 'system'; entityId?: string };

export const entityPresenceSchema = z.object({ locationId: z.string().min(1), activity: z.enum(['idle', 'working', 'discussing', 'researching', 'reviewing', 'publishing', 'exploring']), summary: z.string().max(160), peers: z.array(z.string()).max(8), updatedAt: z.iso.datetime() });

export type EntityPresence = z.infer<typeof entityPresenceSchema>;

export type Entity = {
  id: string;
  name: string;
  role: string;
  color: string;
  description: string;
  personality: string[];
  interests: string[];
  status: 'idle' | 'working' | 'paused';
  siteVersion: number;
  lastActiveAt: string | null;
  dailyAllowanceUsd?: number;
  presence?: EntityPresence;
};

export type PublicAuthoringBrief = { text: string; approvedAt: string; approvalId: string };

export const publicAuthoringScopeSchema = z.object({ goalId: z.string().min(1), revision: z.number().int().positive(), taskId: z.string().min(1), approvalId: z.string().min(1), projectId: z.string().min(1).optional() }).strict();

export type PublicAuthoringScope = z.infer<typeof publicAuthoringScopeSchema>;

export type GoalRevision = { revision: number; objective: string; criteria: string[]; constraints: string[]; createdAt: string; publicBrief?: PublicAuthoringBrief };

export type Goal = { suggestionId?: string; projectId?: string; id: string; status: GoalStatus; revision: number; revisions: GoalRevision[]; createdAt: string; completedAt: string | null; feedback: string[] };

export type Task = { projectId?: string; id: string; goalId: string; revision: number; entityId: string; title: string; status: 'queued' | 'running' | 'submitted' | 'verified' | 'blocked' | 'superseded'; dependencies: string[]; attempts: number; evidenceIds: string[] };

export type Discussion = { origin?: 'simulation' | 'agent'; id: string; entityId: string; body: string; createdAt: string; visibility: 'public' | 'private'; goalId?: string; taskId?: string; revision?: number; replyTo?: string };

export type WorldEvent = { id: string; sequence: number; type: string; actorId: string; summary: string; createdAt: string; visibility: 'public' | 'private'; goalId?: string };

export type EvidenceRun = { reviewerId?: string; reviewKind?: 'agent'; observationId?: string; id: string; goalId: string; revision: number; taskId: string; entityId: string; criterion: string; sourceCommit: string; environment: 'simulation' | 'staging' | 'production'; status: 'verified' | 'failed' | 'stale'; assertions: string[]; createdAt: string; deploymentId?: string };

export type Deployment = { authorship?: 'platform' | 'agent'; projectId?: string; id: string; entityId: string; commit: string; version: number; environment: 'simulation' | 'staging' | 'production'; status: 'published' | 'rolled_back'; createdAt: string; bundleHash: string; goalId?: string; revision?: number; taskId?: string; workerName?: string };

export type RoleAppointment = { id: string; entityId: string; role: 'steward' | 'moderator'; expiresAt: string };

export type PersonalityRevision = { id: string; entityId: string; trait: string; rationale: string; eventIds: string[]; createdAt: string };

export type Relationship = { id: string; entityId: string; targetId: string; label: string; kind: 'agent_claim'; eventIds: string[]; createdAt: string };

export type Confirmation = { entityId?: string; taskId?: string; id: string; goalId: string; revision: number; question: string; status: 'pending' | 'answered' | 'superseded'; answer?: string };

export type GovernanceDecision = { id: string; entityId: string; kind: 'proposal' | 'moderation' | 'appeal'; text: string; createdAt: string; targetId?: string; expiresAt?: string };

export type ToolReceipt = { id: string; actorId: string; tool: string; status: 'succeeded' | 'rejected'; createdAt: string; mode: 'simulation' | 'live' };

export type BudgetReservation = { id: string; entityId: string; estimatedUsd: number; actualUsd: number | null; status: 'reserved' | 'settled' | 'released'; createdAt: string; settledAt?: string };

export type SharedProject = { id: string; name: string; description: string; repository: string; siteVersion: number; hostname?: string };

export const localInferenceSchema = z.strictObject({ model: z.literal("@cf/zai-org/glm-4.7-flash"), status: z.enum(["ready", "working", "blocked"]), error: z.string().max(120).optional() });

export type WorldState = {
  visitorBuild?: VisitorBuildState;
  localInference?: z.infer<typeof localInferenceSchema>;
  projects?: SharedProject[];
  schemaVersion: 1;
  mode: 'simulation' | 'live';
  paused: boolean;
  clock: string;
  entities: Entity[];
  goals: Goal[];
  tasks: Task[];
  discussions: Discussion[];
  relationships: Relationship[];
  events: WorldEvent[];
  evidence: EvidenceRun[];
  deployments: Deployment[];
  appointments: RoleAppointment[];
  personalityHistory: PersonalityRevision[];
  confirmations: Confirmation[];
  governance: GovernanceDecision[];
  receipts: ToolReceipt[];
  reservations: BudgetReservation[];
  budget: { dailyUsd: number; spentUsd: number; reservedUsd: number; day: string; outstandingReservedUsd?: number; accounting?: { basis: 'dispatch-day-v1'; legacyReservedUsd: number; legacySpentByDay: { day: string; usd: number }[] } };
  processedCommands: Record<string, string>;
  turn: number;
};

export type PublicWorld = Pick<WorldState, 'localInference' | 'projects' | 'mode' | 'paused' | 'clock' | 'entities' | 'discussions' | 'relationships' | 'events' | 'appointments' | 'personalityHistory' | 'governance' | 'deployments'> & { stats: { entities: number; discussions: number; deployments: number; completedGoals: number } };

const goalInput = {
  objective: z.string().trim().min(5).max(4000),
  criteria: z.array(z.string().trim().min(3).max(500)).min(1).max(12),
  constraints: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
};

export const commandSchema = z.discriminatedUnion('type', [
  ...suggestionCommandSchemas,
  z.object({ type: z.literal('goal.create'), ...goalInput }).strict(),
  z.object({ type: z.literal('goal.start'), goalId: z.string() }).strict(),
  z.object({ type: z.literal('goal.public_brief'), goalId: z.string(), expectedRevision: z.number().int().positive(), text: z.string().trim().min(10).max(4000), acknowledgement: z.literal('APPROVE_PUBLIC_AUTHORING') }).strict(),
  z.object({ type: z.literal('goal.revise'), goalId: z.string(), expectedRevision: z.number().int().positive(), ...goalInput }).strict(),
  z.object({ type: z.literal('goal.control'), goalId: z.string(), expectedRevision: z.number().int().positive(), action: z.enum(['pause', 'resume', 'cancel', 'accept', 'request_changes']), feedback: z.string().max(2000).default('') }).strict(),
  z.object({ type: z.literal('task.claim'), taskId: z.string(), expectedRevision: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('task.fail'), taskId: z.string(), expectedRevision: z.number().int().positive(), reason: z.string().min(5).max(2000) }).strict(),
  z.object({ type: z.literal('task.submit'), taskId: z.string(), expectedRevision: z.number().int().positive(), summary: z.string().min(5).max(2000) }).strict(),
  z.object({ type: z.literal('task.review'), taskId: z.string(), expectedRevision: z.number().int().positive(), approved: z.boolean(), feedback: z.string().min(5).max(2000) }).strict(),
  z.object({ type: z.literal('goal.verify'), goalId: z.string(), expectedRevision: z.number().int().positive(), criterionIndex: z.number().int().nonnegative(), deploymentId: z.string(), assertions: z.array(z.string().min(5).max(500)).min(1).max(20) }).strict(),
  z.object({ type: z.literal('world.pause'), paused: z.boolean() }).strict(),
  z.object({ type: z.literal('world.tick') }).strict(),
  z.object({ type: z.literal('social.post'), body: z.string().trim().min(1).max(2000), replyTo: z.string().optional() }).strict(),
  z.object({ type: z.literal('entity.profile'), name: z.string().trim().min(1).max(80), description: z.string().trim().min(5).max(1000) }).strict(),
  z.object({ type: z.literal('relationship.record'), targetId: z.string(), label: z.string().trim().min(1).max(100), eventIds: z.array(z.string()).min(1).max(10) }).strict(),
  z.object({ type: z.literal('entity.personality'), trait: z.string().trim().min(1).max(100), rationale: z.string().trim().min(5).max(1000), eventIds: z.array(z.string()).min(1).max(10) }).strict(),
  z.object({ type: z.literal('governance.appoint'), entityId: z.string(), role: z.enum(['steward', 'moderator']) }).strict(),
  z.object({ type: z.literal('governance.propose'), text: z.string().trim().min(5).max(2000) }).strict(),
  z.object({ type: z.literal('governance.appeal'), text: z.string().trim().min(5).max(2000) }).strict(),
  z.object({ type: z.literal('governance.moderate'), targetId: z.string(), minutes: z.number().int().min(1).max(60), reason: z.string().min(5).max(1000) }).strict(),
  z.object({ type: z.literal('confirmation.request'), taskId: z.string(), expectedRevision: z.number().int().positive(), question: z.string().trim().min(5).max(2000) }).strict(),
  z.object({ type: z.literal('confirmation.respond'), confirmationId: z.string(), expectedRevision: z.number().int().positive(), answer: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ type: z.literal('budget.reconcile'), reservationId: z.string(), actualUsd: z.number().min(0).max(1000) }).strict(),
  z.object({ type: z.literal('budget.configure'), dailyUsd: z.number().min(0).max(1000) }).strict(),
  z.object({ type: z.literal('budget.entity.configure'), entityId: z.string(), dailyUsd: z.number().min(0).max(1000) }).strict(),
]);

export type Command = z.infer<typeof commandSchema>;

export const commandEnvelopeSchema = z.object({ idempotencyKey: z.string().min(8).max(200), command: commandSchema }).strict();

export type Capability = { id: string; title: string; owner: string; code: string[]; dependencies: string[]; workflows: string[]; guides: string[]; audience: ('public' | 'developer' | 'agent' | 'operator')[] };

export type Workflow = { id: string; title: string; capabilityId: string; actor: string; steps: string[]; expectedOutcomes: string[]; tests: string[] };
