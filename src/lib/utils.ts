import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Decimal } from "@prisma/client/runtime/library";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a ledger amount for display. The platform is ETB-only — there is no
 * per-user currency and no conversion anywhere.
 */
export function formatCurrency(amount: Decimal | number): string {
  return `ETB ${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function roundETB(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export async function verifyHmacSignature(
  rawBody: string,
  receivedSignature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  // Convert hex string signature → bytes
  const sigBytes = new Uint8Array(
    (receivedSignature.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16))
  );

  // subtle.verify is timing-safe (equivalent to hash_equals in PHP)
  return crypto.subtle.verify("HMAC", cryptoKey, sigBytes, encoder.encode(rawBody));
}
