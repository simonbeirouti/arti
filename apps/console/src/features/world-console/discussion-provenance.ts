import type { Discussion, WorldState } from '../../../../../packages/contracts/src/index';

export function visibleDiscussions(discussions: Discussion[], mode: WorldState['mode']): Discussion[] {
  return discussions.filter(item => mode !== 'live' || item.origin === 'agent');
}

export function discussionProvenance(discussion: Discussion): string {
  if (discussion.origin === 'agent') return 'Agent authored';

  if (discussion.origin === 'simulation') return 'Scripted simulation';

  return 'Unclassified history';
}
