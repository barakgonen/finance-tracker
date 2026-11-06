import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import {
  AttemptLimiter,
  decryptSecret,
  dummyPasswordHash,
  encryptSecret,
  hashPassword,
  hashToken,
  newSessionToken,
  totp,
  verifyPassword,
} from "./auth-core";

describe("passwords", () => {
  it("hashes with argon2id and verifies only the right password", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct horse battery")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
  });

  it("the dummy hash is a real hash, so unknown-email checks cost the same", async () => {
    const h = await dummyPasswordHash();
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "anything")).toBe(false);
  });

  it("treats a malformed stored hash as a failed check, not a crash", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});

describe("session tokens", () => {
  it("are random and stored only as a hash", () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
    expect(Buffer.from(a.token, "base64url").length).toBe(32);
  });
});

describe("totp", () => {
  it("accepts the current code and rejects others", () => {
    const secret = totp.generateSecret();
    expect(totp.check(authenticator.generate(secret), secret)).toBe(true);
    expect(totp.check("000000", secret) && authenticator.generate(secret) !== "000000").toBe(false);
    expect(totp.check("12345", secret)).toBe(false);
    expect(totp.check("abcdef", secret)).toBe(false);
  });

  it("builds an otpauth URI for authenticator apps", () => {
    expect(totp.uri("a@b.c", "JBSWY3DPEHPK3PXP")).toMatch(/^otpauth:\/\/totp\/.*secret=JBSWY3DPEHPK3PXP/);
  });
});

describe("secret encryption", () => {
  const master = randomBytes(32);

  it("round-trips and never stores plaintext", () => {
    const enc = encryptSecret(master, "JBSWY3DPEHPK3PXP");
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(master, enc)).toBe("JBSWY3DPEHPK3PXP");
    expect(encryptSecret(master, "x")).not.toBe(encryptSecret(master, "x")); // random IV
  });

  it("fails with the wrong key or tampered data", () => {
    const enc = encryptSecret(master, "secret");
    expect(() => decryptSecret(randomBytes(32), enc)).toThrow();
    const bytes = Buffer.from(enc, "base64");
    bytes[bytes.length - 1]! ^= 1;
    expect(() => decryptSecret(master, bytes.toString("base64"))).toThrow();
  });
});

describe("AttemptLimiter", () => {
  it("locks a key after the limit and unlocks after the window", () => {
    let now = 0;
    const limiter = new AttemptLimiter(3, 1000, () => now);
    expect([1, 2, 3].map(() => limiter.attempt("k"))).toEqual([true, true, true]);
    expect(limiter.attempt("k")).toBe(false);
    expect(limiter.attempt("other")).toBe(true);
    now = 1001;
    expect(limiter.attempt("k")).toBe(true);
  });

  it("reset clears a key after a successful login", () => {
    const limiter = new AttemptLimiter(1, 1000);
    limiter.attempt("k");
    limiter.reset("k");
    expect(limiter.attempt("k")).toBe(true);
  });
});
