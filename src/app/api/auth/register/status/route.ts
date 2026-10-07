import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp } from "@/lib/adminAuth";
import { redis } from "@/lib/redis";
import { BROWSER_HANDOFF_TTL, issueHandoff } from "@/lib/authHandoff";
import { lastDigits, type SignupStatus } from "@/lib/tgSignupCore";
import { browserMatches, claimBrowserLogin, getPending, SIGNUP_COOKIE, SIGNUP_COOKIE_PATH } from "@/lib/tgSignup";

const schema = z.object({ token: z.string().min(1).max(64) });

const POLLS_PER_MINUTE = 120;

/**
 * POST { token } — where is this Telegram-verified registration?
 *
 * Polled by the registration form while the user is in Telegram. Details are
 * only given to the browser that submitted the form (its httpOnly cookie);
 * to anyone else holding the token every live request looks "pending" and a
 * finished one just "verified" — no names, numbers or logins.
 *
 * On "verified", that browser gets a one-time login handoff, once, which it
 * exchanges via signIn("handoff"). A user who finishes in a different
 * browser uses the bot's "Continue on Website" button instead, or logs in.
 */
export async function POST(req: NextRequest) {
  const key = `su:rl:status:${getClientIp(req)}`;
  await redis.set(key, "0", "EX", 60, "NX");
  if ((await redis.incr(key)) > POLLS_PER_MINUTE) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { token } = parsed.data;
  const secret = req.cookies.get(SIGNUP_COOKIE)?.value;
  const pending = await getPending(token);

  const reply = (body: SignupStatus) => NextResponse.json(body);
  if (!pending) return reply({ status: "expired" });

  const mine = browserMatches(pending, secret);

  if (pending.state === "done") {
    const claim = mine ? await claimBrowserLogin(token, secret) : { ok: false as const };
    if (!claim.ok) return reply({ status: "verified" });
    const res = NextResponse.json({
      status: "verified",
      handoff: await issueHandoff(claim.userId, BROWSER_HANDOFF_TTL),
    } satisfies SignupStatus);
    // Its job is done; drop it.
    res.cookies.set(SIGNUP_COOKIE, "", { path: SIGNUP_COOKIE_PATH, maxAge: 0 });
    return res;
  }

  if (pending.state === "failed" && mine && pending.reason) {
    return reply({
      status: "failed",
      reason: pending.reason,
      phoneEnding: lastDigits(pending.phone),
      ...(pending.sharedEnding ? { sharedEnding: pending.sharedEnding } : {}),
    });
  }

  return reply({ status: "pending" });
}
