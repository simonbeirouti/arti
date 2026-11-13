import { z } from 'zod';
import type { Goal, WorldState } from '../../contracts/src/index';

export const sharedResetId = z.string().uuid();

export function frozenVisitorGoal(state: WorldState, goal: Goal): boolean {
  const proposal = state.visitorBuild?.suggestions.find(item => item.id === goal.suggestionId);
  const current = goal.revisions.find(item => item.revision === goal.revision);

  return Boolean(goal.revision === 1 && proposal?.review && current?.publicBrief?.approvalId === `visitor-approval-${proposal.id}` && current.publicBrief.text === proposal.review.brief && current.objective === proposal.review.brief && JSON.stringify(current.criteria) === JSON.stringify(proposal.review.criteria));
}

/** Clear the shared public workspace without rewriting private goals or financial evidence. */
export function resetSharedPublicState(input: WorldState): WorldState {
  if (!input.paused) throw new Error('Pause world before resetting the shared website');
  const state = structuredClone(input);
  const publicGoals = new Set(state.goals.flatMap(goal => frozenVisitorGoal(state, goal) ? [goal.id] : []));
  state.goals = state.goals.filter(goal => !publicGoals.has(goal.id));
  state.tasks = state.tasks.filter(task => !publicGoals.has(task.goalId));
  state.evidence = state.evidence.filter(evidence => !publicGoals.has(evidence.goalId));
  state.confirmations = state.confirmations.filter(item => !publicGoals.has(item.goalId));
  state.deployments = state.deployments.filter(item => item.projectId !== 'collective' && !publicGoals.has(item.goalId ?? ''));
  state.discussions = state.discussions.filter(item => item.visibility === 'private' && !publicGoals.has(item.goalId ?? ''));
  const removedEvents = new Set(state.events.flatMap(item => item.visibility === 'public' || publicGoals.has(item.goalId ?? '') ? [item.id] : []));
  state.events = state.events.filter(item => !removedEvents.has(item.id));
  state.relationships = state.relationships.filter(item => !item.eventIds.some(id => removedEvents.has(id)));
  state.personalityHistory = state.personalityHistory.filter(item => !item.eventIds.some(id => removedEvents.has(id)));
  state.governance = [];

  state.visitorBuild = { sharedOnly: true, visitors: state.visitorBuild?.visitors ?? [], suggestions: [], submissions: [], observations: [], blockers: [] };
  const project = state.projects?.find(item => item.id === 'collective');

  if (!project) throw new Error('Registered collective project required');
  project.siteVersion = 0;

  return state;
}
