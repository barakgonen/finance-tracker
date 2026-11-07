import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { hebrewError } from "./errors";

describe("hebrewError", () => {
  it("translates known messages and patterns, keeps Hebrew, and never shows unknown English", () => {
    expect(hebrewError("The limit must be positive")).toBe("הסכום צריך להיות גדול מאפס.");
    expect(hebrewError("Unknown category foo")).toBe("הקטגוריה לא נמצאה.");
    expect(hebrewError("This file was already imported (a.pdf)")).toBe("הקובץ הזה כבר יובא (a.pdf).");
    expect(hebrewError("יש להזין סכום")).toBe("יש להזין סכום");
    expect(hebrewError("Something internal")).toBe("משהו השתבש. נסו שוב.");
  });

  it("covers every message the services throw", () => {
    const dir = resolve(__dirname, "../../../../packages/ingest/src");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && statSync(join(dir, f)).isFile());
    const messages = files.flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/new ImportError\("[a-z_]+", "([^"]+)"/g)].map((m) => m[1]!));
    expect(messages.length).toBeGreaterThan(20);
    expect(messages.filter((m) => hebrewError(m) === "משהו השתבש. נסו שוב.")).toEqual([]);
  });
});
