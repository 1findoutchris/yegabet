import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { UsersError } from "./errors";

/**
 * Phone numbers are never stored or logged in plain text (CLAUDE.md §7):
 * - `hashPhone` (HMAC-SHA256) gives the unique key for "one account per phone";
 * - `encryptPhone` (AES-256-GCM) keeps a copy support can read when needed.
 */

/**
 * Ethiopian mobile numbers to E.164 (+2519XXXXXXXX / +2517XXXXXXXX), so
 * "0912 345 678", "912345678" and "+251912345678" are one number.
 */
export function normalizeEthiopianPhone(input: string): string {
  const digits = String(input).replace(/[\s\-().]/g, "");
  const m = /^(?:\+?251|0)?([79]\d{8})$/.exec(digits);
  if (!m) throw new UsersError("INVALID_PHONE", "enter an Ethiopian mobile number (9XXXXXXXX or 7XXXXXXXX)");
  return `+251${m[1] as string}`;
}

export function hashPhone(e164: string, key: string): string {
  return createHmac("sha256", key).update(e164).digest("hex");
}

/** Key is 32 bytes, base64. Output: base64(iv | tag | ciphertext). */
export function encryptPhone(e164: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), iv);
  const ct = Buffer.concat([cipher.update(e164, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptPhone(blob: string, keyB64: string): string {
  const raw = Buffer.from(blob, "base64");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** For logs and screens: +251912345678 → +251****5678. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)}****${e164.slice(-4)}`;
}
