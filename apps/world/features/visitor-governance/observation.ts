import { z } from 'zod';
import type { Goal, WorldState } from '../../../../packages/contracts/src/index';

export const reviewObservationSchema = z.object({ id: z.string().min(1), reviewerId: z.string().min(1), goalId: z.string().min(1), revision: z.number().int().positive(), deploymentId: z.string().min(1), commit: z.string(), bundleHash: z.string(), createdAt: z.string(), status: z.number().int().min(200).max(299), content: z.string().max(24000) }).strict();

export type ReviewObservation = z.infer<typeof reviewObservationSchema>;

/** An operator revision can introduce private content; it never inherits public proposal authority. */
export function publicVisitorGoal(state: WorldState, goal: Goal): boolean {
  const proposal = state.visitorBuild?.suggestions.find(item => item.id === goal.suggestionId);
  const current = goal.revisions.find(item => item.revision === goal.revision);

  return Boolean(proposal?.review && current && goal.revision === 1 && current.publicBrief?.approvalId === `visitor-approval-${proposal.id}` && current.publicBrief.text === proposal.review.brief && current.objective === proposal.review.brief && JSON.stringify(current.criteria) === JSON.stringify(proposal.review.criteria));
}

/** Resolve from canonical authority rather than accepting a URL or worker name. */
export function reviewDeployment(state: WorldState, reviewerId: string, goalId: string, revision: number) {
  const goal = state.goals.find(item => item.id === goalId && item.revision === revision && item.suggestionId && ['active', 'awaiting_acceptance'].includes(item.status));

  if (state.paused || state.mode !== 'live' || !['moderator', 'researcher', 'steward'].includes(reviewerId) || !state.entities.some(item => item.id === reviewerId) || !goal?.projectId || !publicVisitorGoal(state, goal)) throw new Error('Published review is not authorized');
  const project = state.projects?.find(item => item.id === goal.projectId);
  const deployment = state.deployments.findLast(item => item.projectId === goal.projectId && item.version === project?.siteVersion && item.environment === 'production' && item.status === 'published');

  if (!deployment || deployment.goalId !== goal.id || deployment.revision !== revision || deployment.entityId === reviewerId || !deployment.workerName || deployment.workerName !== `${goal.projectId.slice(0, 15)}-${deployment.bundleHash}`) throw new Error('Independent current publication required');

  return { goal, deployment };
}

export function validateObservation(state: WorldState, observation: ReviewObservation): void {
  const { deployment } = reviewDeployment(state, observation.reviewerId, observation.goalId, observation.revision);

  if (deployment.id !== observation.deploymentId || deployment.commit !== observation.commit || deployment.bundleHash !== observation.bundleHash || Date.now() - Date.parse(observation.createdAt) > 10 * 60000 || Date.parse(observation.createdAt) > Date.now() + 1000) throw new Error('Review observation is stale');
}

/** Bound the stream before decoding; oversized output is not silently accepted. */
export async function reviewContent(response: Response): Promise<string> {
  if (!response.ok || !/text\/(html|plain)|application\/json/i.test(response.headers.get('content-type') ?? '')) throw new Error('Review needs successful text content');
  const reader = response.body?.getReader();

  if (!reader) throw new Error('Review content missing');
  const chunks: Uint8Array[] = []; let size = 0;

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) break;
      size += chunk.value.byteLength;

      if (size > 24000) throw new Error('Review content exceeds limit');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }

  const bytes = new Uint8Array(size); let offset = 0;

  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }

  return new TextDecoder().decode(bytes);
}
