import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicBuild } from '../../../../../packages/contracts/src/visitor-build';
import { activePreview, goalStatus, rankedSuggestions } from './model';
import { GoalPanel, PreviewPanel, Timeline } from './SharedWebsite';

function fixture(): PublicBuild {
  return {
    mode: 'simulation', paused: false, entities: [], projects: [{ id: 'collective', name: 'Our site', description: 'Shared website', repository: 'collective', siteVersion: 2 }],
    deployments: [{ id: 'release-2', entityId: 'builder', projectId: 'collective', commit: 'checked', version: 2, status: 'published', environment: 'simulation', createdAt: '2026-10-17T00:00:00.000Z', bundleHash: 'hash' }],
    suggestions: [{ id: 'idea-1', visitorId: 'visitor-1', visitorName: 'Sam', text: 'Build a guide to native plants.', createdAt: '2026-10-17T00:00:00.000Z', status: 'eligible', review: { brief: 'Create a native plant guide', criteria: ['Show plant names'], reason: 'Useful and feasible' }, votes: [{ entityId: 'moderator', approved: true, usefulness: 5, fit: 4, feasibility: 3, reason: 'A useful improvement' }] }],
    discussions: [{ id: 'public-message', entityId: 'builder', body: 'Preparing the native plant guide', visibility: 'public', createdAt: '2026-10-17T00:00:01.000Z', origin: 'simulation' }, { id: 'private-message', entityId: 'builder', body: 'PRIVATE_REASONING', visibility: 'private', createdAt: '2026-10-17T00:00:00.000Z' }],
    events: [{ id: 'public-event', sequence: 2, type: 'goal.selected', actorId: 'steward', summary: 'Selected Sam’s plant guide', visibility: 'public', createdAt: '2026-10-17T00:00:02.000Z' }, { id: 'private-event', sequence: 1, type: 'goal.created', actorId: 'operator', summary: 'PRIVATE_GOAL', visibility: 'private', createdAt: '2026-10-17T00:00:00.000Z' }],
    currentGoal: { id: 'goal-1', revision: 1, title: 'Create a native plant guide', suggestionId: 'idea-1', visitorName: 'Sam', status: 'building', tasks: [{ id: 'task-1', entityId: 'builder', title: 'Build the guide', status: 'verified' }] },
  };
}

describe('shared website public panels', () => {
  it('shows attribution, public task progress, review, votes and decision without private discussion or events', () => {
    const build = fixture();
    const goal = renderToStaticMarkup(createElement(GoalPanel, { build }));
    const timeline = renderToStaticMarkup(createElement(Timeline, { build }));

    expect(goal).toContain('Suggested by');
    expect(goal).toContain('Sam');
    expect(goal).toContain('1/1');
    expect(goal).toContain('Building');
    expect(goal).not.toContain('Current goal');
    expect(goal).not.toContain('Simulation');
    expect(goal).toContain('Task details');
    expect(goal).toContain('shared-agent-chips');
    expect(goal).toContain('<details class="shared-task-details">');
    expect(timeline).toContain('Useful and feasible');
    expect(timeline).toContain('Approve');
    expect(timeline).toContain('12/15');
    expect(timeline).toContain('<details class="shared-review-details">');
    expect(timeline).toContain('Plan &amp; scoring details');
    expect(timeline).toContain('Selected Sam');
    expect(timeline).toContain('Simulated agent');
    expect(timeline).not.toContain('PRIVATE');
  });

  it('shows the platform blocker for inconclusive independent release checks', () => {
    const build = fixture();

    if (!build.currentGoal) throw new Error('Expected goal fixture');

    build.currentGoal.status = 'blocked';
    build.currentGoal.blocker = 'Independent review is inconclusive. The current goal remains active.';
    const html = renderToStaticMarkup(createElement(GoalPanel, { build }));

    expect(html).toContain('Blocked');
    expect(html).toContain('Independent review is inconclusive. The current goal remains active.');
    expect(html).toContain('role="alert"');
  });

  it('explains paused work even before a goal is selected and labels pending ideas clearly', () => {
    const build = fixture();

    build.currentGoal = null;
    build.paused = true;
    expect(renderToStaticMarkup(createElement(GoalPanel, { build }))).toContain('Agent work is paused. Suggestions are saved.');
    expect(goalStatus('pending')).toBe('Awaiting review');
  });

  it('ranks eligible suggestions and avoids repeating a brief or generic voting event', () => {
    const build = fixture();
    const original = build.suggestions[0];

    original.review = { brief: original.text, criteria: ['Show plant names'], reason: 'Useful and feasible' };
    build.suggestions.push({ ...original, id: 'earlier', createdAt: '2026-10-16T00:00:00.000Z' }, { ...original, id: 'pending', status: 'pending' });
    build.events.push({ id: 'vote-event', sequence: 3, type: 'suggestion.vote', actorId: 'moderator', summary: 'REDUNDANT_VOTE', createdAt: original.createdAt, visibility: 'public' });
    const html = renderToStaticMarkup(createElement(Timeline, { build }));

    expect(rankedSuggestions(build.suggestions).map(item => item.id)).toEqual(['earlier', 'idea-1']);
    expect(html).toContain('Queue #1');
    expect(html).toContain('Queue #2');
    expect(html).not.toContain('REDUNDANT_VOTE');
    expect(html.split(original.text)).toHaveLength(4);
  });

  it('requires the exact active project version and rejects invalid live hostnames', () => {
    const build = fixture();

    expect(activePreview(build)).toEqual({ id: 'release-2', version: 2, url: 'http://localhost:4174/' });
    build.projects[0].siteVersion = 3;
    expect(activePreview(build)).toBeNull();
    build.projects[0].siteVersion = 2;
    build.mode = 'live';
    build.projects[0].hostname = 'javascript:alert(1)';
    expect(activePreview(build)).toBeNull();
    build.projects[0].hostname = 'collective.example.com';
    expect(activePreview(build)?.url).toBe('https://collective.example.com/');
  });

  it('isolates the automatically refreshed iframe without a preview toolbar', () => {
    const preview = activePreview(fixture());
    const html = renderToStaticMarkup(createElement(PreviewPanel, { preview, simulation: true }));

    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain('Auto-refresh');
    expect(html).not.toContain('Reload');
    expect(html).not.toContain('shared-preview-toolbar');
    expect(html).toContain('aria-label="The website"');
    expect(html).not.toContain('allow-same-origin');
  });

  it('keeps an empty goal and preview understandable while waiting for the team', () => {
    expect(renderToStaticMarkup(createElement(GoalPanel, { build: null }))).toContain('What should we build next?');
    expect(renderToStaticMarkup(createElement(PreviewPanel, { preview: null, simulation: false }))).toContain('Waiting for the first checked release');
    expect(renderToStaticMarkup(createElement(PreviewPanel, { preview: null, simulation: true }))).toContain('Simulation · no cloud release has been verified.');
    expect(goalStatus('awaiting_acceptance')).toBe('Checking');
    expect(goalStatus('completed')).toBe('Published');
  });
});
