import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BlobStore } from "../src/blobs.js";

describe("BlobStore", () => {
  const root = mkdtempSync(join(tmpdir(), "ft-blob-test-"));
  const store = new BlobStore(root, randomBytes(32));
  const secret = new TextEncoder().encode("פירוט עסקאות 1,234.56");

  it("round-trips and never writes plaintext", async () => {
    const path = await store.put("hh1", secret);
    expect(await store.get(path)).toEqual(secret);
    const onDisk = readFileSync(join(root, path));
    expect(onDisk.includes(Buffer.from(secret))).toBe(false);
  });

  it("detects tampering", async () => {
    const path = await store.put("hh1", new TextEncoder().encode("another file"));
    const full = join(root, path);
    const data = readFileSync(full);
    data[data.length - 1] ^= 0xff;
    writeFileSync(full, data);
    await expect(store.get(path)).rejects.toThrow();
  });

  it("refuses paths outside its root", async () => {
    await expect(store.get("../etc/passwd")).rejects.toThrow(/Invalid blob path/);
    expect(readdirSync(root)).toContain("hh1");
  });
});
