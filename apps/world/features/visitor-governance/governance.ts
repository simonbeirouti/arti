import type { Command, WorldState } from '../../../../packages/contracts/src/index';
import { publicVisitorGoal, reviewDeployment } from './observation';

export type GovernanceAction = { type: 'suggestion.review' | 'suggestion.vote' | 'suggestion.select' | 'suggestion.task_review' | 'suggestion.verify' | 'suggestion.complete'; suggestionId?: string; taskId?: string; goalId?: string; expectedRevision?: number; criterionIndex?: number; deploymentId?: string };

export type GovernanceContext = { action: GovernanceAction; content: string };

const voters = ['moderator', 'researcher', 'steward'];

/** Only reviewed public proposals and trusted receipt metadata enter this fresh context. */
export function governanceContext(state: WorldState, entityId: string): GovernanceContext | null {
  if (state.paused || state.mode !== 'live' || !voters.includes(entityId) || !state.entities.some(item => item.id === entityId)) return null;
  const suggestions = state.visitorBuild?.suggestions ?? [];
  const goal = state.goals.find(item => item.suggestionId && ['active', 'awaiting_acceptance'].includes(item.status) && (!state.visitorBuild?.sharedOnly || publicVisitorGoal(state, item)));
  const suggestion = suggestions.find(item => item.id === goal?.suggestionId);
  const current = goal?.revisions.find(item => item.revision === goal.revision);

  if (goal && suggestion?.review && current && publicVisitorGoal(state, goal)) {
    const tasks = state.tasks.filter(item => item.goalId === goal.id && item.revision === goal.revision);
    const task = tasks.find(item => item.status === 'submitted' && item.entityId !== entityId && entityId === (item.entityId === 'moderator' ? 'researcher' : 'moderator'));

    if (task) {
      const evidence = state.evidence.flatMap(item => item.goalId === goal.id && item.revision === goal.revision && item.taskId === task.id && task.evidenceIds.includes(item.id) && item.status === 'verified' && item.environment === 'production' ? [{ id: item.id, deploymentId: item.deploymentId, sourceCommit: item.sourceCommit, checks: item.assertions.filter(assertion => ['TypeScript compiled', 'Agent tests passed', 'Independent HTTP smoke passed'].includes(assertion)) }] : []);

      return { action: { type: 'suggestion.task_review', taskId: task.id, expectedRevision: goal.revision }, content: JSON.stringify({ brief: suggestion.review.brief, responsibility: `Checked public contribution by ${task.entityId}`, evidence }) };
    }

    const latestAuthor = state.deployments.findLast(item => item.projectId === goal.projectId && item.environment === 'production' && item.status === 'published')?.entityId;
    const criterionReviewer = latestAuthor === 'moderator' ? 'researcher' : 'moderator';

    if (entityId === criterionReviewer && tasks.length && tasks.every(item => item.status === 'verified')) {
      try {
        const { deployment } = reviewDeployment(state, entityId, goal.id, goal.revision);
        const criterionIndex = suggestion.review.criteria.findIndex(criterion => !state.evidence.some(item => item.goalId === goal.id && item.revision === goal.revision && item.criterion === criterion && item.deploymentId === deployment.id && item.reviewKind === 'agent' && item.status === 'verified'));

        if (criterionIndex !== -1) return { action: { type: 'suggestion.verify', goalId: goal.id, expectedRevision: goal.revision, criterionIndex, deploymentId: deployment.id }, content: JSON.stringify({ brief: suggestion.review.brief, criterion: suggestion.review.criteria[criterionIndex], deployment: { id: deployment.id, commit: deployment.commit } }) };
      } catch { /* A missing or self-authored release remains blocked rather than accepting prose. */ }
    }

    if (entityId === 'steward' && goal.status === 'awaiting_acceptance') return { action: { type: 'suggestion.complete', goalId: goal.id, expectedRevision: goal.revision }, content: JSON.stringify({ brief: suggestion.review.brief }) };
  }

  const pending = suggestions.find(item => item.status === 'pending');

  if (pending && entityId === 'moderator') return { action: { type: 'suggestion.review', suggestionId: pending.id }, content: JSON.stringify({ suggestion: { id: pending.id, text: pending.text }, existing: suggestions.slice(-30).map(item => ({ id: item.id, text: item.text, status: item.status })), project: state.projects?.map(item => ({ name: item.name, description: item.description })) }) };
  const voting = suggestions.find(item => ['reviewing', 'eligible'].includes(item.status) && item.review && !item.votes.some(vote => vote.entityId === entityId));

  if (voting) return { action: { type: 'suggestion.vote', suggestionId: voting.id }, content: JSON.stringify({ suggestion: voting.text, review: voting.review, votes: voting.votes }) };

  if (entityId === 'steward' && !state.goals.some(item => !['completed', 'cancelled'].includes(item.status) && (!state.visitorBuild?.sharedOnly || publicVisitorGoal(state, item))) && suggestions.some(item => item.status === 'eligible')) return { action: { type: 'suggestion.select' }, content: '{}' };

  return null;
}

export function requireGovernanceAction(action: GovernanceAction, command: Command): void {
  for (const [key, value] of Object.entries(action)) {
    if (!Object.entries(command).some(([field, actual]) => field === key && actual === value)) throw new Error('Governance operation changed');
  }
}

/** At most one governance slice, with two out of three minutes reserved for builders. */
export function governanceLane(scheduledTime: number, buildReady: boolean): boolean { return !buildReady || Math.floor(scheduledTime / 60000) % 3 === 0; }
