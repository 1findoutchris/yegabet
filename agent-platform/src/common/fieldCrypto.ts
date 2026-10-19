import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Protecting sensitive fields at rest (CLAUDE.md §7): a keyed hash for
 * uniqueness lookups, and AES-256-GCM for the copy that must be read back.
 * Used for phone numbers and payment references.
 */

/** HMAC-SHA256, hex. `domain` separates uses that share a key (phone vs payment reference). */
export function keyedHash(value: string, key: string, domain = ""): string {
  return createHmac("sha256", key)
    .update(domain ? `${domain}:${value}` : value)
    .digest("hex");
}

/** Key is 32 bytes, base64. Output: base64(iv | tag | ciphertext). */
export function encryptField(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptField(blob: string, keyB64: string): string {
  const raw = Buffer.from(blob, "base64");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
