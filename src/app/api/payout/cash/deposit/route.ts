import { NextRequest, NextResponse } from "next/server";
import { requirePayoutAuth } from "@/lib/payoutAuth";
import { cashDeposit, CashError, CASH_MIN, CASH_MAX } from "@/lib/cashAgent";
import { roundETB } from "@/lib/utils";
import { z } from "zod";

const schema = z.object({
  accountNo: z.number().int().positive(),
  amount: z.number().positive(),
});

const MESSAGES: Record<string, { status: number; error: string }> = {
  NOT_CASH_AGENT: { status: 403, error: "This account cannot take counter deposits" },
  USER_NOT_FOUND: { status: 404, error: "No account with that ID" },
  USER_INACTIVE: { status: 404, error: "No account with that ID" },
  INSUFFICIENT_FLOAT: { status: 400, error: "Not enough float — top up before depositing" },
};

export async function POST(req: NextRequest) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const accountNo = parsed.data.accountNo;
  const amount = roundETB(parsed.data.amount);
  if (amount < CASH_MIN || amount > CASH_MAX) {
    return NextResponse.json(
      { error: `Amount must be between ${CASH_MIN} and ${CASH_MAX.toLocaleString()} ETB` },
      { status: 400 },
    );
  }

  try {
    const { float, name } = await cashDeposit(auth.agentId, accountNo, amount);
    return NextResponse.json({ success: true, float, name, amount });
  } catch (e) {
    if (e instanceof CashError) {
      const m = MESSAGES[e.code];
      // The float figure is the agent's own, so telling them the shortfall is
      // information they already have — it just saves a trip to the balance.
      const detail = e.code === "INSUFFICIENT_FLOAT" && e.detail ? ` (${e.detail})` : "";
      return NextResponse.json({ error: m.error + detail }, { status: m.status });
    }
    throw e;
  }
}
