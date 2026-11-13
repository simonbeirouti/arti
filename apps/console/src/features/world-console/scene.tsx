import { useState } from 'react';
import type { PublicWorld, WorldState } from '../../../../../packages/contracts/src/index';
import { Character } from './character';
import { districts } from './map-layout';
import { InhabitantInspector } from './inhabitant-inspector';
import { observedTraffic, type TrafficEdge } from './traffic-view-model';
import { formatTime } from './view-model';

const core = { id: 'collective', x: 500, y: 340 };

function trace(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const middle = (from.x + to.x) / 2;

  return `M${from.x} ${from.y} H${middle} V${to.y} H${to.x}`;
}

function CircuitBoard({ edges }: { edges: TrafficEdge[] }) {
  const points = [...districts, core];

  return <svg viewBox="0 0 1000 680" className="circuit-board" aria-label="Circuit network of eight agents and one shared project">
    <defs><pattern id="circuit-grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#18343d" /></pattern></defs>
    <rect width="1000" height="680" fill="url(#circuit-grid)" />
    <path className="board-boundary" d="M90 90H325l45-45h260l45 45h235v500H675l-45 45H370l-45-45H90Z" />
    {districts.map(point => <path className="circuit-trace" key={point.id} d={trace(point, core)} />)}
    {edges.map(edge => {
      const from = points.find(point => point.id === edge.from);
      const to = points.find(point => point.id === edge.to);

      return from && to ? <g key={edge.id} className={`traffic-link traffic-${edge.status}`}>
        <title>{edge.kind} · {edge.status} · observed {edge.observedAt}</title>
        <path className="traffic-route" d={trace(from, to)} />
        {edge.status === 'active' && <path className="traffic-packet" d={trace(from, to)} />}
      </g> : null;
    })}
    {districts.map(point => <circle key={point.id} className="trace-terminal" cx={point.x} cy={point.y} r="7" />)}
  </svg>;
}

export function WorldScene({ data, state, onObserve, onProject, isPublic }: { data: WorldState | PublicWorld; state: WorldState | null; onObserve: () => void; onProject?: () => void; isPublic: boolean }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.entities.find(entity => entity.id === selectedId);
  const district = districts.find(place => place.id === selected?.id) ?? districts[0];
  const traffic = observedTraffic(data, isPublic);
  const project = data.projects?.find(item => item.id === 'collective') ?? data.projects?.[0];
  const release = project ? data.deployments.findLast(item => item.projectId === project.id && item.version === project.siteVersion) : undefined;
  const name = (id: string) => id === 'collective' ? 'Shared project' : data.entities.find(item => item.id === id)?.name ?? id;

  return <section className={`world-scene ${data.paused ? 'world-paused' : ''}`} aria-label="Interactive digital world">
    <div className="scene-stage">
      <div className="scene-map" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <CircuitBoard edges={traffic} />
        <a className="collective-core" href="/showcase" onClick={onProject ? event => { event.preventDefault(); onProject(); } : undefined} aria-label="Open shared project showcase"><span className="core-icon">◇</span><strong>{project?.name ?? 'Shared project'}</strong><small>CANONICAL CODEBASE</small><span>v{project?.siteVersion ?? 0} · {release?.commit.slice(0, 8) ?? 'Awaiting release'}{release?.status === 'rolled_back' ? ' · restored' : ''}</span></a>
        {districts.flatMap(place => {
          const entity = data.entities.find(item => item.id === place.id);

          if (!entity) return [];
          const active = entity.status === 'working' && !!entity.presence && ['working', 'reviewing', 'publishing', 'discussing', 'researching'].includes(entity.presence.activity);

          return [<button key={place.id} className={`agent-node ${selected?.id === entity.id ? 'selected' : ''} ${active ? 'node-active' : ''}`} style={{ left: place.left, top: place.top, color: place.color }} data-activity={entity.presence?.activity ?? 'idle'} onClick={() => setSelectedId(entity.id)} aria-label={`Meet ${entity.name}, ${entity.role}`} aria-pressed={selected?.id === entity.id}>
            <Character variant={place.variant} color={place.color} /><strong>{entity.name}</strong><span>{place.name}</span><small>{data.paused ? 'PAUSED' : entity.presence?.activity ?? 'idle'}</small>
          </button>];
        })}
      </div>
      <aside className="network-telemetry" aria-label="Observed network traffic"><p className="eyebrow">Traffic monitor</p><h2>{data.paused ? 'Dispatch paused' : 'Observed activity'}</h2><div className="traffic-legend"><span className="legend-queued">{traffic.filter(edge => edge.status === 'queued').length} queued</span><span className="legend-active">{traffic.filter(edge => edge.status === 'active').length} active</span><span className="legend-completed">{traffic.filter(edge => edge.status === 'completed').length} replies</span></div><p className="muted">Working entities and completed public replies. {isPublic ? 'Private task traffic excluded.' : 'Includes operator task handoffs.'}</p><small>Snapshot {formatTime(data.clock)}</small>{traffic.slice(-3).toReversed().map(edge => <div className="traffic-record" key={edge.id}><span>{name(edge.from)} → {name(edge.to)}</span><small>{edge.status} · {formatTime(edge.observedAt)}</small></div>)}{!traffic.length && <p className="muted">No observed traffic. Idle links remain still.</p>}</aside>
    </div>
    <div className="map-controls" aria-label="Map controls"><button onClick={() => setZoom(Math.min(1.8, zoom + .15))} aria-label="Zoom in">+</button><button onClick={() => setZoom(Math.max(.6, zoom - .15))} aria-label="Zoom out">−</button><button onClick={() => setPan({ ...pan, x: pan.x + 80 })} aria-label="Pan map left">←</button><button onClick={() => setPan({ ...pan, x: pan.x - 80 })} aria-label="Pan map right">→</button><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Reset map view">⌖</button></div>
    {selected && <InhabitantInspector isPublic={isPublic} entity={selected} data={data} state={state} district={district} onClose={() => setSelectedId(null)} onObserve={onObserve} />}
  </section>;
}
