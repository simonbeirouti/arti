import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorldEngine } from '../../../../../packages/domain/src/index';
import type { Deployment, Discussion, SharedProject } from '../../../../../packages/contracts/src/index';
import { Showcase } from './showcase';
import { projectReleases, sharedProjectUrl } from './showcase-model';
import { visibleDiscussions, discussionProvenance } from './discussion-provenance';
import { districts } from './map-layout';

const project: SharedProject = { id: 'collective', name: 'Arti Collective', description: 'A shared useful resource', repository: 'collective', siteVersion: 2 };

const release = (id: string, entityId: string, projectId?: string): Deployment => ({ id, entityId, projectId, authorship: 'agent', commit: `commit-${id}`, version: 2, environment: 'production', status: 'published', createdAt: '2026-10-13T00:00:00.000Z', bundleHash: 'checked-bundle' });

describe('shared project showcase', () => {
  it('attributes only shared project releases and filters contributions by entity', () => {
    const deployments = [release('legacy', 'builder-1'), release('nova', 'builder-1', 'collective'), release('flux', 'builder-2', 'collective'), release('other', 'builder-1', 'other-project')];
    expect(projectReleases(deployments, 'collective', 'builder-1').map(item => item.id)).toEqual(['nova']);
    expect(projectReleases(deployments, 'collective').map(item => item.id)).toEqual(['flux', 'nova']);
  });

  it('renders public project details without private goals or legacy personal commits', () => {
    const engine = new WorldEngine();
    const state = engine.dispatch({ role: 'operator' }, { type: 'goal.create', objective: 'SECRET private goal objective', criteria: ['SECRET private criterion'], constraints: [] }, 'showcase-private');
    state.projects = [project];
    state.deployments = [release('legacy-private', 'builder-1'), release('shared', 'builder-1', 'collective')];
    const html = renderToStaticMarkup(createElement(Showcase, { data: state }));
    expect(html).toContain('Arti Collective');
    expect(html).toContain('commit-shared');
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('legacy-private');
    expect(html).toContain('localhost:4174');
    expect(html).toContain('title="Arti Collective project preview"');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });

  it('does not credit a platform starter as an agent contribution', () => {
    const state = new WorldEngine().getPublicState();
    state.projects = [project];
    state.deployments = [{ ...release('starter', 'steward', 'collective'), authorship: 'platform' }];
    const html = renderToStaticMarkup(createElement(Showcase, { data: state }));
    expect(html).toContain('Platform starter');
    expect(html).toContain('Awaiting the first checked contribution');
    expect(html).not.toContain('Atlas');
    expect(projectReleases(state.deployments, 'collective', 'steward')).toEqual([]);
  });

  it('shows the current restored commit after rollback rather than awaiting a release', () => {
    const state = new WorldEngine().getState();
    state.projects = [{ ...project, siteVersion: 3 }];
    state.deployments = [{ ...release('restored', 'builder-1', 'collective'), version: 3, status: 'rolled_back', environment: 'simulation' }];
    const html = renderToStaticMarkup(createElement(Showcase, { data: state }));
    expect(html).toContain('commit-resto');
    expect(html).toContain('restored release');
    expect(html).toContain('Open shared website');
    expect(html).toContain('http://localhost:4174/');
    expect(html).not.toContain('no matching checked release yet');
  });

  it('accepts only platform DNS hostnames for live project links', () => {
    expect(sharedProjectUrl(project, 'live')).toBeNull();
    expect(sharedProjectUrl({ ...project, hostname: 'build.example.com' }, 'live')).toBe('https://build.example.com/');

    for (const hostname of ['javascript:alert(1)', 'example.com/path', 'user@example.com', 'localhost:4174']) expect(sharedProjectUrl({ ...project, hostname }, 'live')).toBeNull();
  });

  it('provides eight distinct team workstations including the additional builders', () => {
    expect(districts).toHaveLength(8);
    expect(new Set(districts.map(item => item.id)).size).toBe(8);
    expect(districts.map(item => item.id)).toEqual(expect.arrayContaining(['builder-3', 'builder-4']));
  });
});

it('keeps scripted and unclassified history out of the live discussion feed', () => {
  const base: Discussion = { id: 'old', entityId: 'builder-1', body: 'An old record', createdAt: '2026-10-13T00:00:00Z', visibility: 'public' };
  const messages: Discussion[] = [base, { ...base, id: 'scripted', origin: 'simulation' }, { ...base, id: 'generated', origin: 'agent' }];
  expect(visibleDiscussions(messages, 'live').map(item => item.id)).toEqual(['generated']);
  expect(visibleDiscussions(messages, 'simulation')).toHaveLength(3);
  expect(discussionProvenance(messages[1])).toBe('Scripted simulation');
  expect(discussionProvenance(base)).toBe('Unclassified history');
});
