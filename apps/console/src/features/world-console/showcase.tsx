import { LocalProjectSource } from "./local-project-source";
import type { PublicWorld, WorldState } from '../../../../../packages/contracts/src/index';
import { Badge, EmptyState, SectionHeading } from '../../../../../packages/ui/src/index';
import { projectReleases, sharedProjectUrl } from './showcase-model';
import { formatTime } from './view-model';

export function Showcase({ data, entityId }: { data: PublicWorld | WorldState; entityId?: string }) {
  const projects = data.projects ?? [];
  const name = (id: string) => data.entities.find(item => item.id === id)?.name ?? id;

  return <>
    <SectionHeading eyebrow="Built together" title="Shared project showcase"><Badge>{data.localInference ? 'Local GLM preview' : data.mode === 'simulation' ? 'Simulation' : 'Live releases'}</Badge></SectionHeading>
    <p className="muted">One shared codebase. Individual contributions, checked builds and traceable releases.</p>
    {entityId && <p>Contributions by {name(entityId)} · <a href="/showcase">Show the whole team</a></p>}
    {!projects.length && <EmptyState title="The shared project is being prepared">Legacy personal releases remain history; they are not shared project contributions.</EmptyState>}
    <div className="stack">{projects.map(project => {
      const allReleases = projectReleases(data.deployments, project.id);
      const releases = projectReleases(data.deployments, project.id, entityId);
      const current = allReleases.find(item => item.version === project.siteVersion);
      const contributors = [...new Set(allReleases.filter(item => item.authorship === 'agent').map(item => item.entityId))];
      const site = sharedProjectUrl(project, data.mode);

      return <article className="panel" key={project.id}>
        <p className="eyebrow">Shared project · {project.id}</p><h3>{project.name}</h3><p>{project.description}</p>
        <p>Published version {project.siteVersion}{current ? ` · ${current.commit.slice(0, 12)}${current.status === 'rolled_back' ? ' · restored release' : ''}` : ' · no matching checked release yet'}</p>
        <p className="muted">Contributors: {contributors.length ? contributors.map(name).join(' · ') : 'Awaiting the first checked contribution'}</p>
        {site && <><a className="button primary" href={site} target="_blank" rel="noreferrer">Open shared website ↗</a><p className="muted"><a href={site} target="_blank" rel="noreferrer">{site}</a></p></>}
        {site ? <iframe key={project.siteVersion} className="project-preview" title={`${project.name} project preview`} src={site} sandbox="allow-scripts" referrerPolicy="no-referrer" /> : <EmptyState title="Preview awaiting a published release">The project preview will appear here when a platform hostname is available.</EmptyState>}
        {data.localInference && "goals" in data && <LocalProjectSource />}
        <h4>Checked contribution history</h4>
        {releases.length ? releases.map(release => <div className="list-row" key={release.id}>
          <div><strong>{release.authorship === 'platform' ? 'Platform starter' : release.authorship === 'agent' ? name(release.entityId) : 'Recorded release'} · Version {release.version}</strong><p><code>{release.commit}</code></p><small>{formatTime(release.createdAt)} · {release.environment}</small></div>
          <Badge tone={release.status === 'published' ? 'green' : 'amber'}>{release.status.replaceAll('_', ' ')}</Badge>
        </div>) : <p className="muted">No checked contributions{entityId ? ' by this teammate' : ''} yet.</p>}
      </article>;
    })}</div>
  </>;
}
