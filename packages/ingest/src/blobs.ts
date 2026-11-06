// Uploaded statements are kept forever (so they can be re-parsed when parsers improve) and are
// encrypted at rest with AES-256-GCM. File layout: iv (12 bytes) | auth tag (16) | ciphertext.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class BlobStore {
  constructor(
    private readonly root: string,
    private readonly key: Buffer,
  ) {
    if (key.length !== 32) throw new Error("File encryption key must be 32 bytes");
  }

  static fromEnv(): BlobStore {
    const key = process.env.FILE_ENCRYPTION_KEY;
    if (!key) throw new Error("FILE_ENCRYPTION_KEY is not set (32 bytes, base64)");
    return new BlobStore(process.env.BLOB_DIR ?? "./data/blobs", Buffer.from(key, "base64"));
  }

  /** Stores bytes under `namespace` and returns the relative path to read them back. */
  async put(namespace: string, bytes: Uint8Array): Promise<string> {
    const path = this.safe(join(namespace, `${sha256(bytes)}.bin`));
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const full = join(this.root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, Buffer.concat([iv, cipher.getAuthTag(), body]), { mode: 0o600 });
    return path;
  }

  async get(path: string): Promise<Uint8Array> {
    const data = await readFile(join(this.root, this.safe(path)));
    const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return new Uint8Array(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]));
  }

  private safe(path: string): string {
    const p = normalize(path);
    if (p.startsWith("..") || p.startsWith(sep)) throw new Error(`Invalid blob path: ${path}`);
    return p;
  }
}
