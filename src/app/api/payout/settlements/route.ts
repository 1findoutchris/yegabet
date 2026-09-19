import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePayoutAuth } from "@/lib/payoutAuth";
import { agentOutstanding, OPEN_SETTLEMENT_STATUS } from "@/lib/agentSettlements";
import { PAYOUT_METHODS } from "@/lib/payoutRouting";
import { z } from "zod";

/** GET — this agent's own settlement requests, plus what they're owed now. */
export async function GET(req: NextRequest) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const [requests, outstanding] = await Promise.all([
    prisma.agentPayoutRequest.findMany({
      where: { agentId: auth.agentId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, amount: true, method: true, account: true, accountName: true,
        status: true, adminNote: true, createdAt: true, paidAt: true,
      },
    }),
    agentOutstanding(auth.agentId),
  ]);

  return NextResponse.json({
    outstanding,
    requests: requests.map((r) => ({ ...r, amount: Number(r.amount) })),
  });
}

const createSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(PAYOUT_METHODS),
  account: z.string().trim().min(3).max(40),
  accountName: z.string().trim().min(2).max(60),
});

/** POST — ask to be paid. No money moves here; an admin writes the SETTLEMENT. */
export async function POST(req: NextRequest) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { amount, method, account, accountName } = parsed.data;

  // One at a time. Two open requests could each be under the balance while
  // together exceeding it, and the admin would have no way to see that from
  // either one on its own.
  const open = await prisma.agentPayoutRequest.count({
    where: { agentId: auth.agentId, status: OPEN_SETTLEMENT_STATUS },
  });
  if (open > 0) {
    return NextResponse.json(
      { error: "You already have a payout request waiting — it has to be settled or rejected first." },
      { status: 409 },
    );
  }

  const outstanding = await agentOutstanding(auth.agentId);
  if (outstanding <= 0) {
    return NextResponse.json({ error: "Nothing is owed to you right now" }, { status: 400 });
  }
  if (amount > outstanding) {
    return NextResponse.json(
      { error: `You can request at most ETB ${outstanding.toFixed(2)}` },
      { status: 400 },
    );
  }

  const request = await prisma.agentPayoutRequest.create({
    data: { agentId: auth.agentId, amount, method, account, accountName },
    select: { id: true },
  });

  return NextResponse.json({ success: true, id: request.id });
}
