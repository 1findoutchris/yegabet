import "server-only";
import { redis } from "@/lib/redis";
import { otpVerdict, type OtpResult } from "@/lib/otpCore";

export type { OtpResult };

// Shared SMS-OTP issue/verify. Both registration and password reset run the
// same code lifecycle, so the attempt-limiting and expiry rules live here once
// rather than being re-implemented per flow.

export const TTL_OTP = 5 * 60; // 5 min — the code itself
export const COOLDOWN = 60;    // 60 s between sends per phone

/**
 * Claim the per-phone send cooldown. Returns false when a code was already
 * sent inside the window — caller should refuse rather than send another.
 */
export async function claimCooldown(phone: string): Promise<boolean> {
  return (await redis.set(`otp:cooldown:${phone}`, "1", "EX", COOLDOWN, "NX")) !== null;
}

/** Release the cooldown so a failed send can be retried immediately. */
export async function releaseCooldown(phone: string): Promise<void> {
  await redis.del(`otp:cooldown:${phone}`);
}

/** Generate, store and return a fresh 6-digit code, resetting past attempts. */
export async function issueOtp(phone: string): Promise<string> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await redis.set(`otp:${phone}`, code, "EX", TTL_OTP);
  await redis.del(`otp:attempts:${phone}`);
  return code;
}

/**
 * Check a submitted code, consuming it on success. Wrong guesses burn an
 * attempt; the code is destroyed after MAX_ATTEMPTS so a stolen handset can't
 * be brute-forced through the 10^6 space. Decision table lives in otpCore.
 */
export async function verifyOtp(phone: string, code: string | undefined): Promise<OtpResult> {
  const stored = await redis.get(`otp:${phone}`);
  const attempts = stored && code !== stored ? await redis.incr(`otp:attempts:${phone}`) : 0;

  const result = otpVerdict(stored, code, attempts);
  if (result.ok || result.status === 429) {
    await redis.del(`otp:${phone}`, `otp:attempts:${phone}`);
  }
  return result;
}
