import { expect, test } from '@playwright/test';
import type { PublicBuild, Visitor } from '../../../../../packages/contracts/src/visitor-build';

test('name onboarding, public submission, exact panels and automatic deployment refresh', async ({ page }) => {
  let visitor: Visitor | null = null;
  let submissions = 0;
  let previewLoads = 0;
  const privateRequests: string[] = [];
  const build: PublicBuild = { mode: 'simulation', paused: false, entities: [], projects: [{ id: 'collective', name: 'Our site', description: 'Built together', repository: 'collective', siteVersion: 1, hostname: 'collective.example.com' }], suggestions: [], discussions: [], events: [], deployments: [{ id: 'release-1', projectId: 'collective', entityId: 'builder', commit: 'first', version: 1, status: 'published', environment: 'simulation', createdAt: '2026-10-17T00:00:00.000Z', bundleHash: 'checked' }], currentGoal: { id: 'goal-current', revision: 1, title: 'Build a useful native plant guide with seasonal advice for visitors', suggestionId: 'existing-idea', visitorName: 'Avery', status: 'building', tasks: Array.from({ length: 8 }, (_, index) => ({ id: `task-${index}`, entityId: `builder-${index}`, title: `Build section ${index}`, status: index === 0 ? 'verified' : 'running' })) } };

  for (let index = 0; index < 18; index += 1) build.discussions.push({ id: `older-${index}`, entityId: 'builder', body: `Earlier team update ${index}. Preparing the shared website.`, createdAt: '2026-10-16T00:00:00.000Z', visibility: 'public', origin: 'simulation' });

  page.on('request', request => {
    if (/\/api\/v1\/(world|session|catalog|commands)(?:\?|$)/.test(request.url())) privateRequests.push(request.url());
  });
  await page.route('http://localhost:4174/**', route => {
    previewLoads += 1;

    return route.fulfill({ contentType: 'text/html', body: '<small>SIMULATION - UI TEST FIXTURE</small><h1>Our shared website</h1>' });
  });
  await page.route('**/api/v1/public/build', route => route.fulfill({ json: build }));
  await page.route('**/api/v1/visitor/session', route => {
    if (route.request().method() === 'POST') visitor = { id: 'visitor-server-id', name: route.request().postDataJSON().name };

    return route.fulfill({ json: { visitor } });
  });
  await page.route('**/api/v1/visitor/suggestions', route => {
    const body = route.request().postDataJSON();

    expect(Object.keys(body).sort()).toEqual(['idempotencyKey', 'text']);
    expect(visitor).not.toBeNull();
    submissions += 1;
    build.suggestions.push({ id: 'suggestion-1', visitorId: 'visitor-server-id', visitorName: 'Sam', text: body.text, createdAt: '2026-10-17T00:00:01.000Z', status: 'pending', votes: [] });

    return route.fulfill({ json: { id: 'suggestion-1' } });
  });
  await page.goto('/world');
  await expect(page.getByRole('region', { name: 'Visitor name', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toHaveCount(0);
  expect(await page.locator('.shared-name-gate').evaluate(panel => getComputedStyle(panel).position)).toBe('absolute');
  await page.screenshot({ path: '/tmp/arti-ui-name-gate.png', fullPage: true });
  await page.getByLabel('What should we call you?').fill('Sam');
  await page.getByRole('button', { name: 'Join the conversation' }).click();
  await expect(page.getByRole('region', { name: 'Visitor name', exact: true })).toHaveCount(0);
  await page.getByLabel('Suggest an improvement as Sam').fill('Build a guide to native plants.');
  await page.getByRole('button', { name: 'Send suggestion' }).click();
  await expect(page.getByText('Suggestion submitted for agent review.')).toBeVisible();
  await expect(page.getByText('Build a guide to native plants.', { exact: true })).toBeInViewport();
  expect(submissions).toBe(1);
  expect(privateRequests).toEqual([]);
  const goal = await page.locator('.shared-goal').boundingBox();
  const chat = await page.locator('.shared-chat').boundingBox();
  const preview = await page.locator('.shared-preview').boundingBox();

  expect(goal?.width).toBe(719);
  expect(preview?.width).toBe(720);
  expect(goal?.height).toBe(190);
  expect(chat?.height).toBe(810);
  await expect(page.locator('.shared-agent-chips li')).toHaveCount(4);
  await expect(page.locator('.shared-agent-chips li').last()).toHaveText('+5');
  await expect(page.locator('.shared-tasks')).not.toBeVisible();
  await page.locator('.shared-task-details summary').click();
  await expect(page.locator('.shared-tasks li')).toHaveCount(8);
  await expect(page.locator('.shared-tasks')).toBeVisible();
  await page.locator('.shared-task-details summary').click();
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect.poll(() => previewLoads).toBe(1);
  build.discussions.push({ id: 'latest-agent', entityId: 'builder', body: 'Latest agent activity after the suggestion', createdAt: '2026-10-17T00:00:02.000Z', visibility: 'public', origin: 'simulation' });
  await expect(page.getByText('Latest agent activity after the suggestion')).toBeInViewport({ timeout: 8000 });
  expect(previewLoads).toBe(1);
  await page.locator('.shared-timeline').evaluate(panel => { panel.scrollTop = 0; });
  build.discussions.push({ id: 'another-agent', entityId: 'builder', body: 'A new update while browsing earlier messages', createdAt: '2026-10-17T00:00:03.000Z', visibility: 'public', origin: 'simulation' });
  await expect(page.getByText('A new update while browsing earlier messages')).toBeAttached({ timeout: 8000 });
  await expect(page.getByText('A new update while browsing earlier messages')).not.toBeInViewport();
  expect(await page.locator('.shared-timeline').evaluate(panel => panel.scrollTop)).toBe(0);
  await page.locator('.shared-timeline').evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
  await expect(page.getByLabel('Auto-refresh')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'The website' })).toBeVisible();
  build.projects[0].siteVersion = 2;
  build.deployments.push({ ...build.deployments[0], id: 'release-2', version: 2, commit: 'second' });
  await expect.poll(() => previewLoads, { timeout: 8000 }).toBe(2);
  await page.reload();
  await expect(page.getByLabel('Suggest an improvement as Sam')).toBeVisible();
  await page.setViewportSize({ width: 1164, height: 655 });
  const shortGoal = await page.locator('.shared-goal').boundingBox();
  const shortChat = await page.locator('.shared-chat').boundingBox();

  expect(shortGoal?.height).toBe(140);
  expect(shortChat?.height).toBe(515);
  await expect(page.locator('.shared-task-details summary')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.shared-agent-chips li').last()).toBeInViewport({ ratio: 1 });
  expect(await page.locator('.shared-goal-quote').evaluate(quote => getComputedStyle(quote).fontStyle)).toBe('italic');
  await expect(page.getByPlaceholder('Suggest an improvement')).toBeVisible();
  const composer = await page.locator('.shared-input-wrapper').boundingBox();
  const send = await page.getByRole('button', { name: 'Send suggestion' }).boundingBox();

  expect(send?.x).toBeGreaterThan(composer?.x ?? -1);
  expect((send?.x ?? 0) + (send?.width ?? 0)).toBeLessThan((composer?.x ?? 0) + (composer?.width ?? 0));
  await page.locator('.shared-timeline').evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
  await page.screenshot({ path: '/tmp/arti-ui-polish-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGoal = await page.locator('.shared-goal').boundingBox();
  const mobileChat = await page.locator('.shared-chat').boundingBox();
  const mobilePreview = await page.locator('.shared-preview').boundingBox();

  expect(mobileChat?.y).toBeGreaterThan(mobileGoal?.y ?? -1);
  expect(mobilePreview?.y).toBeGreaterThan(mobileChat?.y ?? -1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('visitor session retries are bounded and manual recovery preserves the composer draft', async ({ page }) => {
  let sessionCalls = 0;
  let failSession = true;
  let failBuild = false;
  let navigations = 0;
  const build: PublicBuild = { mode: 'simulation', paused: false, entities: [], projects: [], suggestions: [], discussions: [], events: [], deployments: [], currentGoal: null };

  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations += 1; });
  await page.route('**/api/v1/public/build', route => failBuild ? route.fulfill({ status: 503, json: { error: 'The world is reconnecting.' } }) : route.fulfill({ json: build }));
  await page.route('**/api/v1/visitor/session', route => {
    sessionCalls += 1;

    return failSession ? route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }) : route.fulfill({ json: { visitor: { id: 'saved-visitor', name: 'River' } } });
  });
  await page.goto('/world');
  await expect(page.getByRole('region', { name: 'Visitor session', exact: true })).toBeVisible();
  await expect(page.getByLabel('What should we call you?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible({ timeout: 8000 });
  expect(sessionCalls).toBe(3);
  await expect(page.getByText('Connecting your visitor session…')).toHaveCount(0);
  await expect(page.getByText('Your visitor session could not connect. Please try again.')).toBeVisible();
  failSession = false;
  await page.getByRole('button', { name: 'Retry connection' }).click();
  const composer = page.getByLabel('Suggest an improvement as River');

  await expect(composer).toBeVisible();
  expect(sessionCalls).toBe(4);
  expect(navigations).toBe(1);
  await composer.fill('Keep my suggestion draft while the world reconnects.');
  failBuild = true;
  await expect(page.getByRole('alert')).toContainText('The world is reconnecting.', { timeout: 8000 });
  await expect(composer).toHaveValue('Keep my suggestion draft while the world reconnects.');
  await expect(page.getByRole('region', { name: 'Visitor session', exact: true })).toHaveCount(0);
  failBuild = false;
  await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 8000 });
  await expect(composer).toHaveValue('Keep my suggestion draft while the world reconnects.');
  expect(navigations).toBe(1);
});
