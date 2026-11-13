import type { Catalogue } from "../../src/catalog";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Render a deliberately small Markdown subset; raw HTML and executable URLs stay text. */
export function renderMarkdown(markdown: string): string {
  const rendered: string[] = [];
  let inCode = false;

  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      rendered.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }

    const escaped = escapeHtml(line);

    if (inCode) {
      rendered.push(`${escaped}\n`);
      continue;
    }

    const heading = /^(#{1,4}) (.+)$/.exec(escaped);

    if (heading) {
      const level = Math.min(4, (heading[1]?.length ?? 1) + 1);
      rendered.push(`<h${level}>${heading[2] ?? ""}</h${level}>`);
      continue;
    }

    if (!escaped.trim()) continue;

    rendered.push(
      `<p>${escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>")}</p>`,
    );
  }

  if (inCode) rendered.push("</code></pre>");

  return rendered.join("\n");
}

export function renderKnowledge(catalogue: Catalogue): string {
  const guides = catalogue.guides
    .map(
      (guide) =>
        `<article id="${escapeHtml(guide.id)}" class="guide" data-search="${escapeHtml(`${guide.title} ${guide.body}`.toLowerCase())}"><div class="eyebrow">${escapeHtml(guide.id)} · ${escapeHtml(guide.verification)}${guide.verificationEnvironment ? ` / ${escapeHtml(guide.verificationEnvironment)}` : ""}</div><h2>${escapeHtml(guide.title)}</h2><p class="source">Canonical source: <code>${escapeHtml(guide.source)}</code></p>${renderMarkdown(guide.body)}<p class="source">Workflows: ${guide.workflows.map(escapeHtml).join(" · ")}</p></article>`,
    )
    .join("\n");

  const capabilities = catalogue.capabilities
    .map(
      (capability) =>
        `<li><strong>${escapeHtml(capability.title)}</strong><span>${escapeHtml(capability.id)}</span></li>`,
    )
    .join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arti — public knowledge</title><link rel="stylesheet" href="/styles.css"><script src="/search.js" defer></script></head><body><header><a href="/" class="brand">arti.</a><span>Public knowledge / canonical guides</span></header><main><p class="eyebrow">A world that can explain itself</p><h1>Knowledge, connected.</h1><p class="intro">Explore the capabilities, operating principles, and workflow definitions behind Arti.</p><aside class="notice">Definitions describe intended behaviour. Simulation receipts do not establish cloud verification.</aside><label for="guide-search">Find a public guide</label><input id="guide-search" type="search" placeholder="Search titles and content" autocomplete="off"><p id="search-status" role="status">${catalogue.guides.length} public guides</p><section aria-label="Public capabilities"><ul class="capabilities">${capabilities}</ul></section><section aria-label="Canonical public guides">${guides}</section><p id="no-results" hidden>No public guides match your search.</p></main><footer>ARTI · Generated from canonical, audience-scoped sources. Private world records are excluded.</footer></body></html>`;
}
