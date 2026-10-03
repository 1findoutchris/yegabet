import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/providers/octhera";

/**
 * Octhera webhook (set as the Callback URL on Octhera's API keys page).
 *
 * Every bet / win / bet_win / refund / deposit_required / withdraw_* event,
 * signed with `x-octhera-signature`. Octhera has ALREADY moved the money on
 * their wallet; this only records it (OctheraEvent) — User.balance is never
 * touched. Must answer 2xx within 8 s; failures are retried up to 5 times, and
 * repeats are dropped by the (txnId, action) unique key.
 */
interface OctheraWebhook {
  action?: unknown;
  username?: unknown;
  txnId?: unknown;
  balance?: unknown;
  currency?: unknown;
  betAmount?: unknown;
  winAmount?: unknown;
  amount?: unknown;
  gameRound?: unknown;
  gameUid?: unknown;
  gameName?: unknown;
}

const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-octhera-signature") ?? "")) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let e: OctheraWebhook;
  try {
    e = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const txnId = str(e.txnId);
  const action = str(e.action);
  const username = str(e.username);
  if (!txnId || !action || !username) {
    return NextResponse.json({ error: "missing txnId, action or username" }, { status: 400 });
  }

  try {
    await prisma.octheraEvent.createMany({
      data: [{
        txnId,
        action,
        username,
        betAmount: num(e.betAmount) ?? 0,
        winAmount: num(e.winAmount) ?? 0,
        amount: num(e.amount),
        balance: num(e.balance) ?? 0,
        currency: str(e.currency) ?? "ETB",
        gameRound: str(e.gameRound),
        gameUid: str(e.gameUid),
        gameName: str(e.gameName),
        payload: JSON.parse(raw),
      }],
      skipDuplicates: true, // a retried event is already stored — still 200 so Octhera stops
    });
  } catch (err) {
    console.error("[provider/octhera/callback]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 }); // Octhera retries
  }

  return NextResponse.json({ ok: true });
}
