import { describe, expect, it } from "vitest";
import { publicCatalogue } from "../../src/catalog";
import type { Catalogue } from "../../src/catalog";
import { renderKnowledge, renderMarkdown } from "./render";

const fixture: Catalogue = {
  capabilities: [],
  workflows: [],
  guides: [
    {
      id: "guide.public",
      title: "Public guide",
      source: "public.md",
      audience: "public",
      workflows: [],
      verification: "definition",
      body: "# Public knowledge\nSaved outcomes matter.",
    },
    {
      id: "guide.private",
      title: "Private operations",
      source: "private.md",
      audience: "operator",
      workflows: [],
      verification: "definition",
      body: "DO_NOT_PUBLISH_PRIVATE_FIXTURE",
    },
  ],
};

describe("public knowledge publication", () => {
  it("renders only audience-scoped canonical public sources", () => {
    const html = renderKnowledge(publicCatalogue(fixture));
    expect(html).toContain("Saved outcomes matter.");
    expect(html).not.toContain("DO_NOT_PUBLISH_PRIVATE_FIXTURE");
    expect(html).not.toContain("Private operations");
    expect(html).toContain(
      "Simulation receipts do not establish cloud verification",
    );
  });
  it("escapes untrusted markup and executable links rather than interpreting them", () => {
    const html = renderMarkdown(
      "# <script>alert(1)</script>\n[x](javascript:alert(1))\n```\n</code><script>bad()</script>\n```",
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('href="javascript:');
  });
});
