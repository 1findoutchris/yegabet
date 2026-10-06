import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateInitData } from "@/lib/tgInitDataCore";
import { startPath } from "@/lib/tgStartCore";
import { linkedUser, recentOutcome } from "@/lib/tgLink";

const schema = z.object({
  initData: z.string().min(1).max(8192),
  /** While polling after "Verify phone": report link failures newer than this (ms). */
  since: z.number().int().nonnegative().optional(),
});

/**
 * POST { initData } — who is opening the Mini App, as far as Telegram's
 * signature says?
 *
 * Answers only what the opening screen needs to pick a state: is this
 * Telegram account linked, and where did the deep link ask to go. No account
 * data comes back — signing in is a separate step (the "telegram" provider in
 * lib/auth.ts) that validates the same initData again and sets the normal
 * session cookie.
 *
 * POST so initData stays out of access logs, and polled while the user shares
 * their contact, which is why it's cheap: one HMAC and one indexed lookup.
 */
export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_VERIFY_BOT_TOKEN;
  if (!token) return NextResponse.json({ error: "Telegram is not configured" }, { status: 503 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const result = validateInitData(parsed.data.initData, token);
  if (!result.ok) {
    // "expired" is the one a real user hits (app left open for hours); the UI
    // asks them to reopen. Everything else is a forgery or a broken client.
    return NextResponse.json({ error: result.reason }, { status: 401 });
  }

  const user = await linkedUser(result.user.id);
  const linkError = !user && parsed.data.since !== undefined
    ? await recentOutcome(result.user.id, parsed.data.since)
    : null;
  return NextResponse.json({
    linked: !!user,
    linkError,
    firstName: result.user.first_name ?? null,
    startPath: startPath(result.startParam),
    // Public: needed for the "open the bot" fallback on old Telegram clients.
    botUsername: (process.env.TELEGRAM_VERIFY_BOT_USERNAME ?? "").replace(/^@/, "") || null,
  });
}
