import { NextRequest, NextResponse } from "next/server";
import { requirePayoutAuth } from "@/lib/payoutAuth";
import { logAdminAction, getClientIp } from "@/lib/adminAuth";
import { reverseCashDeposit, CashError } from "@/lib/cashAgent";
import { z } from "zod";

const schema = z.object({ depositId: z.string().min(1) });

const MESSAGES: Record<string, { status: number; error: string }> = {
  DEPOSIT_NOT_FOUND: { status: 404, error: "No cancellable deposit with that id" },
  WINDOW_EXPIRED: { status: 400, error: "Too late to cancel this — ask an admin to reverse it" },
  ALREADY_REVERSED: { status: 409, error: "That deposit has already been cancelled" },
  FUNDS_SPENT: { status: 400, error: "The player has already played with this money — it cannot be cancelled" },
};

export async function POST(req: NextRequest) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const result = await reverseCashDeposit(auth.agentId, parsed.data.depositId);

    // Written to the same audit table as admin actions — it is an audit trail,
    // not an admin-only one, and a reversal is exactly the kind of agent action
    // someone will later need to account for.
    await logAdminAction({
      action: "CASH_DEPOSIT_REVERSED_BY_AGENT",
      targetId: auth.agentId,
      targetType: "WithdrawalAgent",
      ipAddress: getClientIp(req),
      metadata: {
        depositId: parsed.data.depositId,
        amount: result.amount,
        player: result.name,
        floatAfter: result.float,
      },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    if (e instanceof CashError) {
      const m = MESSAGES[e.code] ?? { status: 400, error: "Could not cancel that deposit" };
      return NextResponse.json({ error: m.error }, { status: m.status });
    }
    throw e;
  }
}
