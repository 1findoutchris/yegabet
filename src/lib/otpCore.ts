// Pure OTP decision table, split out of otp.ts so it's testable without redis
// (same shape as adsCore / rewardConfigCore).

export const MAX_ATTEMPTS = 5;

/**
 * Is signup verification switched off? Opt-in by exact string, so a missing,
 * empty or misspelled value leaves OTP ON — a typo must not silently open
 * registration.
 *
 * Registration only. Password reset never consults this: the code is the only
 * proof that whoever is asking owns the number, so skipping it there would hand
 * over any account to anyone who can type its phone number.
 */
export function signupOtpDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OTP_DISABLED === "true";
}

/**
 * Which rail delivers the verification code.
 *
 * "telegram" — the user proves the number by sharing their Telegram contact
 *              with the verification bot; the code never leaves the server.
 * "sms"      — the original rail, a code texted through the handset pool.
 *
 * Opt-in by exact string, same reasoning as the kill switch above: a typo or a
 * half-finished bot setup falls back to SMS, which always works, rather than to
 * a channel that silently can't deliver. Flip back to SMS by unsetting it.
 */
export function otpChannel(env: NodeJS.ProcessEnv = process.env): "telegram" | "sms" {
  return env.AUTH_OTP_CHANNEL === "telegram" ? "telegram" : "sms";
}

export type OtpResult = { ok: true } | { ok: false; error: string; status: number };

/**
 * Decide the outcome of a code submission.
 *
 * @param stored   the code held for this phone, or null if none/expired
 * @param code     what the user submitted
 * @param attempts failed-attempt count *including* this one (0 when not a miss)
 *
 * A 429 verdict means the stored code must be destroyed — the caller is
 * responsible for that, same as it is on success.
 */
export function otpVerdict(
  stored: string | null,
  code: string | undefined,
  attempts: number,
): OtpResult {
  if (!stored) {
    return { ok: false, error: "Verification code expired. Please request a new one.", status: 400 };
  }
  if (code !== stored) {
    if (attempts >= MAX_ATTEMPTS) {
      return { ok: false, error: "Too many attempts. Please request a new code.", status: 429 };
    }
    return { ok: false, error: "Incorrect verification code.", status: 400 };
  }
  return { ok: true };
}
