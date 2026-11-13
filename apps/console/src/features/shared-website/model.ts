import type { PublicBuild, Suggestion } from '../../../../../packages/contracts/src/visitor-build';
import { sharedProjectUrl } from '../world-console/showcase-model';

export type Preview = { id: string; url: string; version: number };

/** A hostname alone never establishes that a build was published. */
export function activePreview(build: PublicBuild): Preview | null {
  const project = build.projects[0];

  if (!project) return null;

  const release = build.deployments.findLast(item => item.projectId === project.id && item.version === project.siteVersion);
  const url = sharedProjectUrl(project, build.mode);

  if (!release || !url) return null;

  return { id: release.id, url, version: release.version };
}

export function goalStatus(status: string): string {
  switch (status) {
    case 'active': return 'Building';
    case 'awaiting_acceptance': return 'Checking';
    case 'completed': return 'Published';
    case 'draft': return 'Queued';
    case 'pending': return 'Awaiting review';
    default: return status.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
  }
}

export function rankedSuggestions(suggestions: Suggestion[]): Suggestion[] {
  const score = (suggestion: Suggestion) => suggestion.votes.reduce((total, vote) => total + vote.usefulness + vote.fit + vote.feasibility, 0);

  return suggestions.filter(suggestion => suggestion.status === 'eligible').sort((left, right) => score(right) - score(left) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}
