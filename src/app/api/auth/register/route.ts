import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizePhone, isEthiopianAttempt } from "@/lib/sms";
import { verifyOtp } from "@/lib/otp";
import { signupOtpDisabled } from "@/lib/otpCore";
import { createUserAccount } from "@/lib/registration";
import { getClientIp } from "@/lib/adminAuth";
import { redis } from "@/lib/redis";
import { phoneVariants } from "@/lib/tgLinkCore";
import { telegramSignupEnabled } from "@/lib/tgSignupCore";
import { createPending, newBrowserSecret, PENDING_TTL, SIGNUP_COOKIE, SIGNUP_COOKIE_PATH } from "@/lib/tgSignup";
import bcrypt from "bcryptjs";
import { z } from "zod";

const registerSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name").max(60, "Name too long"),
  phone: z
    .string()
    .min(9, "Phone number too short")
    .regex(/^[+\d\s()-]+$/, "Invalid phone number"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  referralCode: z.string().optional(),
  code: z.string().optional(),
  // Admin-issued rigged-link code from `?promo=` — not something a user types.
  promoCode: z.string().trim().min(1).max(64).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { name, phone, password, referralCode, code, promoCode } = parsed.data;

    // Telegram-verified registration: no account is created here, whatever
    // the request carries (a `code`, OTP_DISABLED, a foreign number — none of
    // them skip it). The bot webhook creates the account once the user's own
    // Telegram contact proves the number. See lib/tgSignup.ts.
    if (telegramSignupEnabled()) {
      return startTelegramSignup(req, { name, phone, password, referralCode, promoCode });
    }

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return NextResponse.json({ error: "Phone number already registered" }, { status: 409 });
    }

    // Ethiopian numbers must verify the SMS OTP issued by /api/auth/otp/send.
    // Non-Ethiopian numbers (normalizePhone → null) skip this, matching the
    // send endpoint's { skip: true } path.
    // Captured once so the OTP gate and the coupon guard below can't drift: a
    // failed verifyOtp returns 4xx here, so past this point a truthy
    // `otpVerified` is exactly "OTP was issued and passed".
    // Reject a malformed Ethiopian number outright rather than letting it fall
    // through as "foreign, no OTP needed". The client decides which flow to run,
    // so without this guard a direct POST — or a typo'd number the OTP endpoint
    // also skipped — creates a fully unverified account.
    if (!normalizePhone(phone) && isEthiopianAttempt(phone)) {
      return NextResponse.json(
        { error: "Enter a valid Ethiopian phone number (9XXXXXXXX or 7XXXXXXXX)." },
        { status: 400 }
      );
    }

    // Two different questions, so two variables — they only coincide while OTP
    // is on:
    //   ethiopian    — is there an SMS rail for this number at all? Also what
    //                  the welcome coupons key off, so a signup still feels like
    //                  a signup while verification is switched off.
    //   otpVerified  — did a code actually get issued and passed? Nothing
    //                  pretends it did, so the referral grant (farmable at
    //                  scale: one referrer, unlimited fake referees) stays shut
    //                  until OTP is back on.
    const ethiopian = !!normalizePhone(phone);
    const otpVerified = ethiopian && !signupOtpDisabled();
    if (otpVerified) {
      const otp = await verifyOtp(phone, code);
      if (!otp.ok) return NextResponse.json({ error: otp.error }, { status: otp.status });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await createUserAccount({
      name, phone, passwordHash, referralCode, promoCode, ethiopian, otpVerified,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[auth/register]", error);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}

// ── Telegram-verified registration ──────────────────────────────────────────

const PER_IP_PER_HOUR = 10;
const PER_PHONE_PER_HOUR = 5;

/** Fixed-window counter; true while under `limit`. */
async function underLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  await redis.set(key, "0", "EX", windowSec, "NX");
  return (await redis.incr(key)) <= limit;
}

async function startTelegramSignup(
  req: NextRequest,
  f: { name: string; phone: string; password: string; referralCode?: string; promoCode?: string },
) {
  // The form only takes Ethiopian mobiles, and the contact is matched in E.164,
  // so anything else could never be verified.
  const e164 = normalizePhone(f.phone);
  if (!e164) {
    return NextResponse.json(
      { error: "Enter a valid Ethiopian phone number (9XXXXXXXX or 7XXXXXXXX)." },
      { status: 400 },
    );
  }

  if (!(await underLimit(`su:rl:ip:${getClientIp(req)}`, PER_IP_PER_HOUR, 3600))) {
    return NextResponse.json({ error: "Too many sign-up attempts. Please try again later." }, { status: 429 });
  }
  if (!(await underLimit(`su:rl:phone:${e164}`, PER_PHONE_PER_HOUR, 3600))) {
    return NextResponse.json({ error: "Too many attempts for this number. Please try again later." }, { status: 429 });
  }

  const existing = await prisma.user.findFirst({ where: { phone: { in: phoneVariants(e164) } }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: "Phone number already registered" }, { status: 409 });
  }

  const secret = newBrowserSecret();
  const { token, url, expiresIn } = await createPending(
    {
      name: f.name,
      phone: e164,
      passwordHash: await bcrypt.hash(f.password, 12),
      ...(f.referralCode ? { referralCode: f.referralCode.toUpperCase() } : {}),
      ...(f.promoCode ? { promoCode: f.promoCode } : {}),
    },
    secret,
    req.cookies.get(SIGNUP_COOKIE)?.value,
  );

  const res = NextResponse.json({ pending: { token, url, expiresIn } }, { status: 202 });
  res.cookies.set(SIGNUP_COOKIE, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: SIGNUP_COOKIE_PATH,
    maxAge: PENDING_TTL,
  });
  return res;
}
