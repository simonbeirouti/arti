import { test, expect, type Page } from "@playwright/test";
import { parseWorldState } from "../../packages/domain/src/index";
import type { WorldState } from "../../packages/contracts/src/index";

async function openWorldPanel(page: Page, name: string) {
  await page.getByRole("button", { name: "More", exact: false }).click();
  await page.getByRole("link", { name, exact: true }).click();
}

const secret = "Private direction ALPHA-9381";

test("operator directs a versioned goal, observes work, and accepts simulated completion", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Eight agents/ })).toBeVisible();
  await expect(
    page.getByText("Simulation environment", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ask the team" }).click();
  await page
    .getByLabel("Your shared goal")
    .fill(`${secret}: create a useful knowledge garden`);
  await page.getByRole("button", { name: "Continue →" }).click();
  await page
    .getByLabel("Acceptance criteria")
    .fill("Publish a verified simulation knowledge garden");
  await page.getByLabel("Constraints").fill("Use fixture sources only");
  await page.getByRole("button", { name: "Create goal draft →" }).click();
  await page.getByRole("button", { name: "Start shared goal →" }).click();
  await expect(
    page.getByRole("button", { name: "Pause goal", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause goal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume goal" })).toBeVisible();
  await page.getByRole("button", { name: "Resume goal" }).click();
  await page.getByRole("button", { name: "Change direction" }).click();
  await page
    .getByLabel("Updated direction")
    .fill(`${secret}: build a revised simulation garden`);
  await page.getByRole("button", { name: "Save new direction →" }).click();
  await expect(
    page.getByText("Shared goal · revision 2", { exact: true }),
  ).toBeVisible();

  for (let index = 0; index < 10; index += 1) {
    await page.getByRole("button", { name: "Advance simulation" }).click();
    await expect(
      page.getByRole("button", { name: "Advance simulation" }),
    ).toBeEnabled();
  }

  await expect(
    page.getByRole("button", { name: "Accept simulated completion" }),
  ).toBeVisible();
  await openWorldPanel(page, "Discussions");
  await expect(page.getByText("Read only", { exact: true })).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
  await openWorldPanel(page, "Evidence");
  await expect(
    page.getByText("Simulation only", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText(
        "Simulation fixture only: not cloud or live-model verification",
      )
      .first(),
  ).toBeVisible();
  await openWorldPanel(page, "Overview");
  await page
    .getByRole("button", { name: "Accept simulated completion" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "A goal completed. A world still growing.",
    }),
  ).toBeVisible();

  const state: WorldState = await (
    await page.request.get("/api/v1/world")
  ).json();

  expect(state.goals.at(-1)?.status).toBe("completed");
  expect(state.budget.spentUsd).toBe(0);
  expect(state.goals.at(-1)?.revisions).toHaveLength(2);
  await page.screenshot({
    path: "test-results/operator-world.png",
    fullPage: true,
  });
  await openWorldPanel(page, "Operations");
  await page.getByLabel("Atlas daily cap (USD)").fill("12.50");
  await page.getByRole("button", { name: "Save Atlas cap" }).click();
  await expect(
    page.getByText("Current cap: $12.50 / day", { exact: true }),
  ).toBeVisible();

  const capped: WorldState = await (
    await page.request.get("/api/v1/world")
  ).json();

  expect(
    capped.entities.find((entity) => entity.id === "steward")
      ?.dailyAllowanceUsd,
  ).toBe(12.5);
  expect(capped.budget.dailyUsd).toBe(0);
  expect(capped.budget.spentUsd).toBe(0);
  expect(capped.mode).toBe("simulation");
  await page.screenshot({
    path: "test-results/operator-resource-caps.png",
    fullPage: true,
  });
});

test("public visitors suggest work and observe the simulated shared build without operator APIs", async ({ page, request }) => {
  const privateRequests: string[] = [];
  page.on('request', incoming => {
    if (/\/api\/v1\/(world|session|catalog|commands)(?:\?|$)/.test(incoming.url())) privateRequests.push(incoming.url());
  });
  await page.goto('/world');
  await expect(page.getByRole('heading', { name: 'What should we build next?' })).toBeVisible();
  await expect(page.locator('.agent-node')).toHaveCount(0);
  await page.getByLabel('What should we call you?').fill('Jordan');
  await page.getByRole('button', { name: 'Join the conversation' }).click();
  await page.getByLabel('Suggest an improvement as Jordan').fill('Add a useful navigation guide to the shared website');
  await page.getByRole('button', { name: 'Send suggestion' }).click();
  await expect(page.getByText('Suggestion submitted for agent review.')).toBeVisible();
  expect(privateRequests).toEqual([]);
  const projection = await request.get('/api/v1/public/build');
  expect(await projection.text()).not.toContain(secret);
  await page.reload();
  await expect(page.getByLabel('Suggest an improvement as Jordan')).toBeVisible();
  const preview = page.getByTitle('Website being built by the agents');
  await expect(preview).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(preview).toHaveAttribute('referrerpolicy', 'no-referrer');
  const owner = await request.get('/api/v1/session');
  expect(owner.ok()).toBe(true);

  for (let tick = 0; tick < 20; tick += 1) {
    const response = await request.post('/api/v1/commands', { data: { command: { type: 'world.tick' }, idempotencyKey: `public-build-tick-${tick}` } });
    expect(response.ok()).toBe(true);
  }

  await expect(page.getByRole('heading', { name: 'Add a useful navigation guide to the shared website' })).toBeVisible();
  await expect(page.getByText('Suggested by', { exact: false })).toBeVisible();
  await expect(page.locator('.shared-status')).toContainText('Published');
  await expect(page.locator('body')).not.toContainText(secret);
  await expect(page.getByRole('button', { name: 'Advance simulation' })).toHaveCount(0);

  const sizes = await page.evaluate(() => {
    const left = document.querySelector('.shared-activity')!.getBoundingClientRect();
    const right = document.querySelector('.shared-preview')!.getBoundingClientRect();
    const goal = document.querySelector('.shared-goal')!.getBoundingClientRect();
    const chat = document.querySelector('.shared-chat')!.getBoundingClientRect();

    return { left: left.width, right: right.width, goal: goal.height, chat: chat.height };
  });

  expect(Math.abs(sizes.left - sizes.right)).toBeLessThan(2);
  expect(sizes.goal).toBeGreaterThanOrEqual(140);
  expect(sizes.goal).toBeLessThanOrEqual(190);
  expect(sizes.chat).toBeGreaterThan(sizes.goal * 3);
  await page.screenshot({ path: 'test-results/public-shared-build.png', fullPage: true });
  await page.goto('/showcase');
  await expect(page.getByRole('region', { name: 'The website', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/public-shared-build-mobile.png', fullPage: true });
});

test("live review controls require independent task review and criterion verification before acceptance", async ({
  page,
}) => {
  // This browser fixture exercises live-mode interfaces without any provider execution.
  const { WorldEngine, createInitialState } =
    await import("../../packages/domain/src/index");

  const { commandEnvelopeSchema } =
    await import("../../packages/contracts/src/index");

  const preparation = new WorldEngine(createInitialState());
  preparation.dispatch(
    { role: "operator" },
    {
      type: "goal.create",
      objective: "Review the live-mode interface fixture",
      criteria: ["Independently inspect persisted fixture output"],
      constraints: [],
    },
    "fixture-create-live",
  );
  const goalId = preparation.getState().goals[0]?.id;

  if (!goalId) throw new Error("Fixture goal missing");

  preparation.dispatch(
    { role: "operator" },
    { type: "goal.start", goalId },
    "fixture-start-live",
  );
  const fixture = preparation.getState();
  fixture.mode = "live";

  for (const task of fixture.tasks)
    task.status = task.entityId === "researcher" ? "submitted" : "verified";

  fixture.deployments.push({
    id: "fixture-staging-deployment",
    entityId: "researcher",
    goalId,
    revision: 1,
    commit: "fixture-source-revision",
    version: 1,
    environment: "staging",
    status: "published",
    createdAt: fixture.clock,
    bundleHash: "fixture-hash",
  });
  const engine = new WorldEngine(fixture);
  await page.route("**/api/v1/world", (route) =>
    route.fulfill({ json: engine.getState() }),
  );
  await page.route("**/api/v1/commands", async (route) => {
    const envelope = commandEnvelopeSchema.parse(
      route.request().postDataJSON(),
    );

    const next = engine.dispatch(
      { role: "operator" },
      envelope.command,
      envelope.idempotencyKey,
    );

    await route.fulfill({ json: next });
  });
  await page.goto("/");
  await expect(
    page.getByText("Live environment", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Advance simulation" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Ask the team" }).click();
  await page
    .getByLabel("Review findings")
    .fill("Independently inspected saved fixture output and source revision.");
  await page.getByRole("button", { name: "Record task review" }).click();
  await expect(
    page.getByRole("heading", { name: "Work awaiting your review" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Accept verified completion" }),
  ).toHaveCount(0);
  await openWorldPanel(page, "Evidence");
  await page
    .getByLabel("Checked deployment")
    .selectOption("fixture-staging-deployment");
  await page
    .getByLabel("Verified assertions")
    .fill("Saved fixture output independently checked against the criterion.");
  await page
    .getByRole("button", { name: "Record criterion verification" })
    .click();
  await openWorldPanel(page, "Overview");
  await page
    .getByRole("button", { name: "Accept verified completion" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "A goal completed. A world still growing.",
    }),
  ).toBeVisible();
  expect(engine.getState().goals[0]?.status).toBe("completed");
});

test("generated public knowledge bundle searches canonical guides without private sources", async ({
  page,
}) => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const { buildPublicKnowledge } =
    await import("../../apps/knowledge/features/publication/build");

  const output = await mkdtemp("/tmp/arti-knowledge-browser-");

  try {
    await buildPublicKnowledge(process.cwd(), output);
    await page.route("http://knowledge.localhost/**", async (route) => {
      const filename = new URL(route.request().url()).pathname;

      const assets = new Map([
        ["/", ["index.html", "text/html"]],
        ["/styles.css", ["styles.css", "text/css"]],
        ["/search.js", ["search.js", "text/javascript"]],
      ]);

      const asset = assets.get(filename);

      if (!asset) return route.fulfill({ status: 404, body: "Not found" });

      await route.fulfill({
        body: await readFile(join(output, asset[0] ?? "index.html")),
        contentType: asset[1],
      });
    });
    await page.goto("http://knowledge.localhost/");
    await expect(
      page.getByRole("heading", { name: "Knowledge, connected." }),
    ).toBeVisible();
    await page
      .getByLabel("Find a public guide")
      .fill("Canonical knowledge and evidence");
    await expect(page.locator("article:visible")).toHaveCount(1);
    await expect(
      page
        .getByRole("heading", {
          name: "Canonical knowledge and evidence",
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await page
      .getByLabel("Find a public guide")
      .fill("no-guide-has-this-title-9381");
    await expect(
      page.getByText("No public guides match your search."),
    ).toBeVisible();
    await page.getByLabel("Find a public guide").fill("");
    await page.screenshot({
      path: "test-results/public-knowledge.png",
      fullPage: true,
    });
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("operator retains a full viewport circuit network with selectable agents and optional controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".agent-node")).toHaveCount(8);
  await expect(page.locator(".world-overlay")).toHaveCount(0);
  const bounds = await page.locator(".world-scene").boundingBox();
  const viewport = page.viewportSize();
  expect(bounds?.width).toBe(viewport?.width);
  expect(bounds?.height).toBe(viewport?.height);
  await page.getByRole("button", { name: /Meet Atlas/ }).click();
  await expect(
    page.getByRole("complementary", { name: "Selected inhabitant" }),
  ).toContainText("Atlas");
  await page.getByRole("button", { name: "Close inhabitant profile" }).click();
  await expect(
    page.getByRole("complementary", { name: "Selected inhabitant" }),
  ).toHaveCount(0);
  const map = page.locator(".scene-map");
  const initial = await map.getAttribute("style");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  expect(await map.getAttribute("style")).not.toBe(initial);
  await page.getByRole("button", { name: "Pan map left" }).click();
  await page.getByRole("button", { name: "Reset map view" }).click();
  expect(await map.getAttribute("style")).toBe(initial);
  await openWorldPanel(page, "Team");
  await expect(page.locator(".entity-card")).toHaveCount(8);
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(page.locator(".world-overlay")).toHaveCount(0);
  await page.getByRole("button", { name: "Hide controls" }).click();
  await expect(
    page.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Show controls" }).click();
  await expect(
    page.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/full-world-map.png" });
});

test("circuit links show recorded replies and expose private work only to operators", async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.agent-node')).toHaveCount(8);

  const command = async (
    value: import("../../packages/contracts/src/index").Command,
  ) => {
    const response = await page.request.post("/api/v1/commands", {
      headers: { Origin: "http://127.0.0.1:5173" },
      data: { command: value, idempotencyKey: crypto.randomUUID() },
    });

    expect(response.ok()).toBe(true);

    return parseWorldState(await response.text());
  };

  const before: WorldState = await (await page.request.get('/api/v1/world')).json();
  let interacting = before;

  for (let tick = 0; tick < 6 && !interacting.discussions.some(item => item.replyTo && item.visibility === 'public'); tick++) {
    interacting = await command({ type: 'world.tick' });
  }

  const publicReply = interacting.discussions.findLast(item => item.replyTo && item.visibility === 'public');

  if (!publicReply) throw new Error('Expected a persisted simulation reply');
  await page.goto('/');
  await expect(page.locator('.traffic-completed').first()).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Observed network traffic' })).toContainText('Includes operator task handoffs.');
  const actor = interacting.entities.find(entity => entity.id === publicReply.entityId);

  if (!actor) throw new Error('Reply entity missing');
  await page.getByRole('button', { name: new RegExp(`Meet ${actor.name},`) }).click();
  await expect(page.getByRole('complementary', { name: 'Selected inhabitant' })).toContainText('Public conversations');
  await page.screenshot({ path: 'test-results/circuit-traffic.png' });
  await command({ type: "world.pause", paused: true });
  await page.reload();
  await expect(page.locator(".world-scene")).toHaveClass(/world-paused/);
  await command({ type: "world.pause", paused: false });

  const draft = await command({
    type: "goal.create",
    objective: "PRIVATE dynamic-map objective",
    criteria: ["Useful public result"],
    constraints: [],
  });

  const goalId = draft.goals.at(-1)!.id;
  const active = await command({ type: "goal.start", goalId });
  const assignment = active.tasks.find((task) => task.goalId === goalId)!;

  const assignedEntity = active.entities.find(
    (entity) => entity.id === assignment.entityId,
  )!;

  await page.goto("/");
  await page
    .getByRole("button", { name: new RegExp(`Meet ${assignedEntity.name},`) })
    .click();
  await expect(page.locator(".private-assignment")).toContainText(
    assignment.title,
  );
  await page.goto("/world");
  await expect(page.getByRole("region", { name: "The website", exact: true })).toBeVisible();
  await expect(page.locator(".private-assignment")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain(
    "PRIVATE dynamic-map",
  );
  await command({
    type: "goal.control",
    goalId,
    expectedRevision: 1,
    action: "cancel",
    feedback: "Browser scenario cleanup",
  });
});

test("public authoring needs a separate exact-text confirmation and resets on goal revision", async ({
  page,
}) => {
  const { WorldEngine, createInitialState } =
    await import("../../packages/domain/src/index");

  const { commandEnvelopeSchema } =
    await import("../../packages/contracts/src/index");

  const engine = new WorldEngine(createInitialState());
  engine.dispatch(
    { role: "operator" },
    {
      type: "goal.create",
      objective: "PRIVATE_BRIEF_TEST_OBJECTIVE",
      criteria: ["Check private saved output"],
      constraints: [],
    },
    "brief-fixture-create",
  );
  const goal = engine.getState().goals[0];

  if (!goal) throw new Error("Brief fixture goal missing");
  engine.dispatch(
    { role: "operator" },
    { type: "goal.start", goalId: goal.id },
    "brief-fixture-start",
  );
  const approvedCommands: string[] = [];
  await page.route("**/api/v1/world", (route) =>
    route.fulfill({ json: engine.getState() }),
  );
  await page.route("**/api/v1/commands", async (route) => {
    const envelope = commandEnvelopeSchema.parse(
      route.request().postDataJSON(),
    );

    if (envelope.command.type === "goal.public_brief")
      approvedCommands.push(JSON.stringify(envelope.command));
    await route.fulfill({
      json: engine.dispatch(
        { role: "operator" },
        envelope.command,
        envelope.idempotencyKey,
      ),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Ask the team" }).click();
  const field = page.getByLabel("Public-safe brief");

  const approve = page.getByRole("button", {
    name: "Approve public authoring brief",
  });

  const confirmation = page.getByRole("checkbox", {
    name: "I approve this exact text for public authoring and publication.",
  });

  await expect(field).toHaveValue("");
  await expect(approve).toBeDisabled();
  await field.fill("Create a public guide explaining the agent world.");
  await expect(approve).toBeDisabled();
  await confirmation.check();
  await field.fill(
    "Create a public guide explaining the shared project website.",
  );
  await expect(confirmation).not.toBeChecked();
  await expect(approve).toBeDisabled();
  await confirmation.check();
  await approve.click();
  await expect(
    page.getByRole("heading", { name: "Approved public brief", exact: true }),
  ).toBeVisible();
  await expect(field).toHaveCount(0);
  expect(approvedCommands).toHaveLength(1);
  expect(approvedCommands[0]).not.toContain("PRIVATE_BRIEF_TEST_OBJECTIVE");
  expect(approvedCommands[0]).not.toContain("Check private saved output");
  expect(engine.getState().goals[0]?.revisions[0]?.publicBrief?.text).toBe(
    "Create a public guide explaining the shared project website.",
  );
  await page
    .getByRole("button", { name: "Change direction", exact: true })
    .click();
  await page.getByLabel("Updated direction").fill("PRIVATE_REVISED_OBJECTIVE");
  await page.getByRole("button", { name: "Save new direction" }).click();
  await expect(field).toHaveValue("");
  await expect(confirmation).not.toBeChecked();
  await expect(approve).toBeDisabled();
  expect(
    engine.getState().goals[0]?.revisions.at(-1)?.publicBrief,
  ).toBeUndefined();
});


test("expanded project embeds the site alongside half-width world", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Open shared project showcase' }).click();
  const world = page.getByRole('region', { name: 'Interactive digital world' });
  const panel = page.getByRole('region', { name: 'Showcase panel' });
  await expect(panel).toBeVisible();
  const worldBox = await world.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(worldBox?.width).toBe(720);
  expect(panelBox?.width).toBe(720);
  expect(panelBox?.x).toBe(720);
  const preview = page.locator('iframe.project-preview');
  await expect(preview).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(preview.contentFrame().locator('body')).toContainText(/Arti/i);
  await page.getByRole('button', { name: 'Close panel' }).click();
  expect((await world.boundingBox())?.width).toBe(1440);
});

test('local GLM UI shows real inference status and keeps scripted controls hidden', async ({ page }) => {
  await page.route('**/api/v1/world', async route => {
    const response = await route.fetch();
    const state = parseWorldState(await response.text());
    state.localInference = { model: '@cf/zai-org/glm-4.7-flash', status: 'ready' };
    state.budget.dailyUsd = 1;
    await route.fulfill({ response, json: state });
  });
  await page.goto('/');
  await expect(page.getByText('Local GLM agents', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Advance simulation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask the team' }).click();
  await expect(page.getByRole('region', { name: 'Local GLM status' })).toContainText('$1.00/day');
  await expect(page.getByLabel('Your shared goal')).toBeVisible();
});
