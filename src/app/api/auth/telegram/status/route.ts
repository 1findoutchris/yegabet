import { NextRequest, NextResponse } from "next/server";
import { takeCode } from "@/lib/tgVerify";
import { z } from "zod";

const schema = z.object({ token: z.string().min(1).max(64) });

/**
 * Has the bot confirmed this verification yet?
 *
 * The signup page polls this while the user is over in Telegram. On success it
 * gets the verification code — which the user never sees or types — and submits
 * it to /api/auth/register or /api/auth/password/reset exactly as the SMS rail
 * always did.
 *
 * POST rather than GET so the token stays out of access logs and referrers, and
 * so nothing between here and the browser can cache a "not yet" answer for the
 * life of the poll.
 */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const code = await takeCode(parsed.data.token);
  // A token that was never issued, has expired, or was already collected is
  // indistinguishable from one still waiting — there is nothing useful to tell
  // a caller guessing tokens, and the page's own timeout covers the real cases.
  return NextResponse.json(code ? { code } : { pending: true });
}
