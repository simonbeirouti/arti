import { describe, expect, it } from "vitest";
import { entityShowcase, lines, readable } from "./view-model";
import { WorldEngine } from '../../../../../packages/domain/src/index';

describe("goal intake", () => {
  it("keeps meaningful acceptance criteria in order without blank outcomes", () => {
    expect(lines(" Publish the resource \n\n Verify saved output\n ")).toEqual([
      "Publish the resource",
      "Verify saved output",
    ]);
  });
  it("renders readable statuses", () => {
    expect(readable("awaiting_acceptance")).toBe("awaiting acceptance");
  });
  it('links every entity to shared project contributions rather than personal hosting', () => {
    const entity = new WorldEngine().getState().entities[0];
    expect(entityShowcase(entity)).toBe('/showcase?entity=steward');
  });
});
