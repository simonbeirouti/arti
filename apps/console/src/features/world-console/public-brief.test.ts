import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Goal } from "../../../../../packages/contracts/src/index";
import { PublicBrief } from "./public-brief";

const privateObjective = "PRIVATE_OBJECTIVE_NO_PUBLIC_COPY";

function fixture(): Goal {
  return {
    id: "goal-fixture",
    status: "active",
    revision: 1,
    revisions: [
      {
        revision: 1,
        objective: privateObjective,
        criteria: ["Private acceptance criterion"],
        constraints: [],
        createdAt: "2026-10-12T00:00:00.000Z",
      },
    ],
    createdAt: "2026-10-12T00:00:00.000Z",
    completedAt: null,
    feedback: [],
  };
}

const dispatch = async () => true;

describe("public authoring approval interface", () => {
  it("renders a blank public field without private objective or criterion text", () => {
    const markup = renderToStaticMarkup(
      createElement(PublicBrief, { goal: fixture(), dispatch, busy: false }),
    );

    expect(markup).not.toContain(privateObjective);
    expect(markup).not.toContain("Private acceptance criterion");
    expect(markup).toMatch(/<textarea[^>]*><\/textarea>/);
    expect(markup).toContain('type="checkbox"');
    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*>Approve public authoring brief/,
    );
  });
  it("renders approved content as escaped read-only text without another approval form", () => {
    const goal = fixture();
    goal.revisions[0].publicBrief = {
      text: "Publish a useful <script>safe</script> guide.",
      approvedAt: "2026-10-12T01:00:00.000Z",
      approvalId: "approval-fixture",
    };

    const markup = renderToStaticMarkup(
      createElement(PublicBrief, { goal, dispatch, busy: false }),
    );

    expect(markup).toContain("&lt;script&gt;safe&lt;/script&gt;");
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain("<form");
    expect(markup).toContain("approved for revision 1");
  });
  it("does not offer approval during completion acceptance or after cancellation", () => {
    for (const status of [
      "awaiting_acceptance",
      "cancelled",
      "completed",
      "blocked",
    ] as const) {
      const markup = renderToStaticMarkup(
        createElement(PublicBrief, {
          goal: { ...fixture(), status },
          dispatch,
          busy: false,
        }),
      );

      expect(markup).not.toContain("<form");
      expect(markup).toContain("no approved brief");
    }
  });
});
