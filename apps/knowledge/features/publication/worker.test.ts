import { describe, expect, it } from "vitest";
import worker from "../../src/index";

describe("public knowledge worker", () => {
  it("serves assets with browser execution boundaries and no response cookies", async () => {
    const environment = {
      ASSETS: {
        fetch: async () =>
          new Response("<h1>Public fixture</h1>", {
            headers: { "Set-Cookie": "private=fixture" },
          }),
      },
    };

    const response = await worker.fetch(
      new Request("https://knowledge.example/"),
      environment,
    );

    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(await response.text()).toContain("Public fixture");
  });
  it("rejects mutation methods without invoking asset code", async () => {
    const environment = {
      ASSETS: {
        fetch: async (): Promise<Response> => {
          throw new Error("Assets should not run");
        },
      },
    };

    const response = await worker.fetch(
      new Request("https://knowledge.example/", { method: "POST" }),
      environment,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });
});
