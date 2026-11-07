import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  /** 32-byte base64 master key: encrypts statement files and, via a derived key, TOTP secrets. */
  get encryptionKey(): Buffer {
    const key = Buffer.from(required("FILE_ENCRYPTION_KEY"), "base64");
    if (key.length !== 32) throw new Error("FILE_ENCRYPTION_KEY must decode to 32 bytes");
    return key;
  },
  get blobDir() {
    return process.env.BLOB_DIR ?? "./data/blobs";
  },
  /** The assistant runs only when explicitly enabled and a Claude API key is configured. */
  get aiEnabled() {
    return process.env.AI_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY;
  },
  /** Secure cookies need HTTPS; a LAN-only install over plain HTTP can opt out explicitly. */
  get cookieSecure() {
    return process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production";
  },
};
