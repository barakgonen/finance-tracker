import { describe, expect, it } from "vitest";
import { en } from "../messages/en";
import { he } from "../messages/he";

const leaves = (o: object): string[] => Object.values(o).flatMap((v) => (typeof v === "string" ? [v] : leaves(v)));

describe("messages", () => {
  it("English has every Hebrew key (the type checks the shape) and no Hebrew left in it", () => {
    expect(leaves(en).length).toBe(leaves(he).length);
    expect(leaves(en).filter((s) => /[֐-׿]/.test(s))).toEqual([]);
  });
});
