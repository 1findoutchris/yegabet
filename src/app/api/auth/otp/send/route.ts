import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizePhone, isEthiopianAttempt, sendSms } from "@/lib/sms";
import { claimCooldown, releaseCooldown, issueOtp } from "@/lib/otp";
import { signupOtpDisabled, otpChannel } from "@/lib/otpCore";
import { beginVerification, verifyBotConfigured } from "@/lib/tgVerify";
import { z } from "zod";

const schema = z.object({
  phone: z.string().min(9, "Phone number too short"),
  // "register" needs the phone to be free; "reset" needs it to already exist.
  purpose: z.enum(["register", "reset"]).default("register"),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  const { purpose } = parsed.data;
  const phone = parsed.data.phone.trim();
  const e164 = normalizePhone(phone);

  // An Ethiopian number that won't normalize is a typo, not a foreign number.
  // Without this it fell through to `skip: true` and the client registered with
  // no verification at all — e.g. `0912345678`, which the 9-char field
  // truncates to `+251091234567`.
  if (!e164 && isEthiopianAttempt(phone)) {
    return NextResponse.json(
      { error: "Enter a valid Ethiopian phone number (9XXXXXXXX or 7XXXXXXXX)." },
      { status: 400 }
    );
  }

  // Genuinely non-Ethiopian number → no SMS rail, so no OTP.
  if (!e164) {
    // Registration lets the client proceed without a code; a reset can't —
    // there is no other channel to prove ownership of the number.
    if (purpose === "reset") {
      return NextResponse.json(
        { error: "Password reset is only available for Ethiopian numbers." },
        { status: 400 }
      );
    }
    return NextResponse.json({ skip: true });
  }

  const existing = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (purpose === "register" && existing) {
    return NextResponse.json({ error: "Phone number already registered" }, { status: 409 });
  }
  if (purpose === "reset" && !existing) {
    return NextResponse.json({ error: "No account found for this number." }, { status: 404 });
  }

  // Signup verification switched off — same answer as a foreign number, so the
  // client registers straight away with no code step. Placed after the
  // duplicate-phone check so "already registered" still comes back as 409, and
  // it never covers `reset`.
  if (purpose === "register" && signupOtpDisabled()) {
    return NextResponse.json({ skip: true });
  }

  // Telegram rail: nothing is sent anywhere. The user proves the number by
  // handing the bot their contact, and the code is delivered to the page by
  // /api/auth/telegram/status once that lands — so the verify screen shows a
  // link rather than a code field.
  //
  // Placed after every check above so the "already registered" / "no account"
  // answers are identical on both rails, and before the cooldown because
  // beginVerification is idempotent per number and needs no send throttle.
  if (otpChannel() === "telegram" && verifyBotConfigured()) {
    const { token, url } = await beginVerification(phone, purpose);
    return NextResponse.json({ telegram: { url, token } });
  }

  // Rate-limit: one send per phone per cooldown window.
  if (!(await claimCooldown(phone))) {
    return NextResponse.json(
      { error: "Please wait a moment before requesting another code." },
      { status: 429 }
    );
  }

  const code = await issueOtp(phone);

  const ok = await sendSms(
    e164,
    `Your VinnaBet code is ${code}. Expires in 5 minutes.`
  );
  if (!ok) {
    // Let the user retry immediately — the send, not the user, failed.
    await releaseCooldown(phone);
    return NextResponse.json(
      { error: "Could not send the code. Please try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({ sent: true });
}
