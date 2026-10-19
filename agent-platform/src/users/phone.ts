import { decryptField, encryptField, keyedHash } from "../common/fieldCrypto";
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
  return keyedHash(e164, key);
}

/** Key is 32 bytes, base64 (see common/fieldCrypto). */
export function encryptPhone(e164: string, keyB64: string): string {
  return encryptField(e164, keyB64);
}

export function decryptPhone(blob: string, keyB64: string): string {
  return decryptField(blob, keyB64);
}

/** For logs and screens: +251912345678 → +251****5678. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)}****${e164.slice(-4)}`;
}
