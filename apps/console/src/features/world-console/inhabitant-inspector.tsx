import type { Entity, PublicWorld, WorldState } from '../../../../../packages/contracts/src/index';
import { Character } from './character';
import { visibleDiscussions } from './discussion-provenance';
import { currentAssignment, mapActivity } from './map-activity';
import { entityShowcase, formatTime, readable } from './view-model';
import type { districts } from './map-layout';

export function InhabitantInspector({ entity, data, state, district, onClose, onObserve, isPublic }: {
  entity: Entity; data: PublicWorld | WorldState; state: WorldState | null; district: (typeof districts)[number]; onClose: () => void; onObserve: () => void; isPublic: boolean;
}) {
  const activity = mapActivity(entity, data.entities);
  const task = currentAssignment(entity.id, isPublic ? null : state);
  const messages = visibleDiscussions(data.discussions, data.mode).filter(message => message.entityId === entity.id && message.visibility === 'public').slice(-2).reverse();
  const contributions = data.deployments.filter(item => item.entityId === entity.id && item.authorship === 'agent' && item.projectId && data.projects?.some(project => project.id === item.projectId));
  const deployment = contributions.at(-1);
  const showcase = entityShowcase(entity);

  return <aside className="character-inspector" aria-label="Selected inhabitant">
    <button className="close-character" onClick={onClose} aria-label="Close inhabitant profile">×</button>
    <div className="inspector-character"><Character variant={district.variant} color={district.color} /><span className={`character-state ${entity.status}`}>{data.paused ? 'Paused' : activity.label}</span></div>
    <p className="eyebrow">{activity.locationName} / {entity.role}</p>
    <h2>{entity.name}</h2>
    <p>{entity.description}</p>
    <section className="inhabitant-focus" aria-label="Current activity">
      <h3>Right now</h3>
      <p>{activity.summary}</p>
      {activity.peers.length > 0 && <p className="interaction-peers">With {activity.peers.join(' & ')}</p>}
      {task && <div className="private-assignment"><span className="eyebrow">Operator · current assignment</span><h4>{task.title}</h4><p>{readable(task.status)} · Attempt {task.attempts}</p><p>{task.dependencies.length} dependencies · {task.evidenceIds.length} evidence records</p></div>}
      {entity.presence && <small>Observed {formatTime(entity.presence.updatedAt)}{data.mode === 'simulation' ? ' · simulation clock' : ''}</small>}
    </section>
    <div className="tags">{entity.personality.slice(0, 3).map(trait => <span key={trait}>{trait}</span>)}</div>
    <dl className="character-facts"><div><dt>Shared contributions</dt><dd>{contributions.length} checked releases</dd></div><div><dt>Connections</dt><dd>{data.relationships.filter(item => item.entityId === entity.id || item.targetId === entity.id).length}</dd></div>{deployment && <div><dt>Latest release</dt><dd>{deployment.environment} · {deployment.commit.slice(0, 8)}</dd></div>}</dl>
    {messages.length > 0 && <section className="inhabitant-messages" aria-label="Recent public interactions"><h3>Public conversations</h3>{messages.map(message => <blockquote key={message.id}>{message.body}<small>{formatTime(message.createdAt)}</small></blockquote>)}</section>}
    <a className="button primary" href={showcase}>See {entity.name}’s contributions →</a>
    <button className="scene-conversation-link" onClick={onObserve}>Observe conversations →</button>
  </aside>;
}
