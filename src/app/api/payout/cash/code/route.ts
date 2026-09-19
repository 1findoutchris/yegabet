import { NextRequest, NextResponse } from "next/server";
import { requirePayoutAuth } from "@/lib/payoutAuth";
import { lookupCode, redeemCode, CashError } from "@/lib/cashAgent";
import { z } from "zod";

/*
 * GET  — what a code is worth, without consuming it. The agent reads the name
 *        and amount back before any notes change hands.
 * POST — pay it. The code is dead the moment this succeeds.
 */

const MESSAGES: Record<string, { status: number; error: string }> = {
  CODE_NOT_FOUND: { status: 404, error: "No cash withdrawal with that code" },
  // Same message as not-found: a wrong-agent code is one this agent has no
  // business knowing exists, so confirming it does would be a probing oracle.
  WRONG_AGENT: { status: 404, error: "No cash withdrawal with that code" },
  CODE_ALREADY_USED: { status: 409, error: "That code has already been used" },
  NOT_CASH_AGENT: { status: 403, error: "This account cannot pay cash withdrawals" },
  INSUFFICIENT_FLOAT: { status: 400, error: "Not enough float" },
};

function fail(e: unknown): NextResponse {
  if (e instanceof CashError) {
    const m = MESSAGES[e.code] ?? { status: 400, error: "Could not process that code" };
    return NextResponse.json({ error: m.error }, { status: m.status });
  }
  throw e;
}

export async function GET(req: NextRequest) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const code = req.nextUrl.searchParams.get("code") ?? "";
  if (!code.trim()) return NextResponse.json({ error: "Enter a code" }, { status: 400 });

  try {
    return NextResponse.json(await lookupCode(auth.agentId, code));
  } catch (e) {
    return fail(e);
  }
}

const schema = z.object({ code: z.string().min(3).max(20) });

export async function POST(req: NextRequest) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const result = await redeemCode(auth.agentId, parsed.data.code);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return fail(e);
  }
}
