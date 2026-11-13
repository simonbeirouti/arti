import type { Deployment, SharedProject, WorldState } from '../../../../../packages/contracts/src/index';

export function projectReleases(deployments: Deployment[], projectId: string, entityId?: string): Deployment[] {
  return deployments.filter(item => item.projectId === projectId && (!entityId || item.entityId === entityId && item.authorship === 'agent')).toReversed();
}

export function sharedProjectUrl(project: SharedProject, mode: WorldState['mode']): string | null {
  if (mode === 'simulation') return 'http://localhost:4174/';

  return project.hostname && /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(project.hostname) ? `https://${project.hostname}/` : null;
}

