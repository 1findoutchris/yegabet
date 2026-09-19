import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizePhone, isEthiopianAttempt } from "@/lib/sms";
import { verifyOtp } from "@/lib/otp";
import { signupOtpDisabled } from "@/lib/otpCore";
import { getRewardConfig } from "@/lib/rewardConfig";
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

function generateUsername(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return "user_" + digits.slice(-8);
}

/**
 * Award the referrer a prize-wheel spin for a genuine signup.
 *
 * Three guards, because a spin is backed by real prizes and registration is
 * free:
 *   1. The referee must have passed SMS OTP — the caller's own gate verdict, so
 *      a signup that skipped verification (foreign number, or OTP_DISABLED)
 *      carries no anti-sybil signal and earns the referrer nothing. They still
 *      get the first-deposit cash bonus, which is gated on money instead.
 *   2. One grant per referee for all time — enforced by the unique index on
 *      SpinCreditGrant.refereeId, not by application code.
 *   3. A rolling 7-day ceiling per referrer. Rolling rather than a calendar
 *      week: no timezone question, and no Monday-midnight reset to front-load.
 *
 * Never allowed to fail the registration — a spin credit is not worth turning a
 * created account into a 500 the user retries with a now-taken phone number.
 */
async function grantSpinCreditForReferral(
  referrerId: string | undefined,
  refereeId: string,
  otpVerified: boolean,
): Promise<void> {
  if (!referrerId) return;
  if (!otpVerified) return; // guard 1: no OTP, no spin

  try {
    const { spinWheel } = await getRewardConfig();
    if (!spinWheel.enabled || spinWheel.creditsPerReferral <= 0) return;

    await prisma.$transaction(async (tx) => {
      // ponytail: count-then-insert, so two simultaneous signups under one code
      // can both pass at cap−1. Off-by-one on a cap is not a payout bug.
      // Upgrade path if it ever matters: SELECT ... FOR UPDATE on the referrer.
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recent = await tx.spinCreditGrant.count({
        where: { referrerId, createdAt: { gte: weekAgo } },
      });
      if (recent >= spinWheel.maxCreditsPerWeek) return; // guard 3

      // guard 2: a repeat referee throws P2002 and aborts the transaction.
      await tx.spinCreditGrant.create({
        data: { referrerId, refereeId, credits: spinWheel.creditsPerReferral },
      });
      await tx.user.update({
        where: { id: referrerId },
        data: { spinCredits: { increment: spinWheel.creditsPerReferral } },
      });
    });
  } catch (e) {
    console.error("[auth/register] spin credit grant failed", e);
  }
}

/**
 * Claim an admin-issued rigged link for this signup. Single-use: the compare-
 * and-set below is the entire mechanism.
 *
 * Two concurrent `UPDATE … WHERE claimedByUserId IS NULL` contend on the row;
 * the loser re-evaluates the predicate against the committed version and
 * updates 0 rows. Exactly one winner, always — same shape as the spinCredits
 * debit and the stock decrement in the spin route.
 *
 * Deliberately NOT gated on OTP, unlike the signup coupons: the link is
 * admin-issued and single-use, so its blast radius is one prize the admin
 * chose — there is nothing to farm.
 */
async function claimPromoLink(code: string | undefined, userId: string): Promise<void> {
  if (!code) return;
  try {
    await prisma.spinLink.updateMany({
      where: { code, claimedByUserId: null },
      data: { claimedByUserId: userId, claimedAt: new Date() },
    });
    // Silent on count 0. A dead or wrong code must not tell the caller which it
    // was — that turns the signup form into an oracle for guessing codes.
  } catch (e) {
    console.error("[auth/register] promo link claim failed", e);
  }
}

// djb2 hash → 6-char base36 code (same algorithm as in account API)
function computeReferralCode(id: string): string {
  let h = 5381;
  for (const c of id) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return h.toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { name, phone, password, referralCode, code, promoCode } = parsed.data;

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

    // Resolve referrer (ignore invalid/expired codes silently)
    let referredById: string | undefined;
    if (referralCode) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode: referralCode.toUpperCase() },
        select: { id: true },
      });
      if (referrer) referredById = referrer.id;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let username = generateUsername(phone);

    const usernameExists = await prisma.user.findUnique({ where: { username } });
    if (usernameExists) {
      username = username + "_" + Date.now().toString().slice(-4);
    }

    // Welcome coupons. Granted inside the create rather than as a follow-up
    // update: zero extra queries, atomic with the row, and structurally
    // impossible to double-grant. Foreign numbers still get none — no rail, no
    // signal — but OTP_DISABLED does not withhold them: with it on, every
    // Ethiopian signup counts, and the exposure is `signupCredits` per fake
    // number rather than per referrer. Keep the number small while it's off.
    // getRewardConfig is React-cached, so the referral helper's later call is
    // deduped against this one.
    const { spinWheel } = await getRewardConfig();
    const signupCredits =
      ethiopian && spinWheel.enabled ? Math.max(0, spinWheel.signupCredits) : 0;

    const user = await prisma.user.create({
      data: {
        name,
        phone,
        username,
        passwordHash,
        spinCredits: signupCredits,
        ...(referredById ? { referredById } : {}),
      },
      select: { id: true },
    });

    // Store the user's own referral code so it's searchable
    const ownCode = computeReferralCode(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { referralCode: ownCode },
    });

    await grantSpinCreditForReferral(referredById, user.id, otpVerified);
    await claimPromoLink(promoCode, user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[auth/register]", error);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
