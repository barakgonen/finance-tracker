// Authentication primitives with no Next.js dependency (unit-tested directly).
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { authenticator } from "otplib";

// --- passwords ---

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  // argon2id with the library's defaults (m=19456 KiB, t=2, p=1), OWASP's recommended minimum
  return hash(password);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password).catch(() => false);
}

let dummyHash: Promise<string> | undefined;

/**
 * A real hash of a random password. Verifying a login for an unknown email against it costs the
 * same time as a real check, so response timing doesn't reveal which emails have accounts.
 */
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

// --- session tokens ---

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// --- TOTP ---

authenticator.options = { window: 1 }; // accept the previous/next 30s step for clock drift

export const totp = {
  generateSecret: () => authenticator.generateSecret(),
  uri: (account: string, secret: string) => authenticator.keyuri(account, "Finance Tracker", secret),
  check: (code: string, secret: string) => /^\d{6}$/.test(code) && authenticator.check(code, secret),
};

// --- secret encryption (TOTP secrets at rest) ---

function secretKey(master: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "ft:totp-secret:v1", 32));
}

export function encryptSecret(master: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(master), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decryptSecret(master: Buffer, encoded: string): string {
  const data = Buffer.from(encoded, "base64");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(master), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

// --- brute-force protection ---

/**
 * Fixed-window attempt limiter. In-memory is enough for a single-process self-hosted install;
 * keys combine the account and the client address.
 */
export class AttemptLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns false when the key is locked out; otherwise records the attempt. */
  attempt(key: string): boolean {
    const t = this.now();
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= t) {
      this.attempts.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.max;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}
