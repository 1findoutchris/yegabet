import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { agentOutstanding, OPEN_SETTLEMENT_STATUS } from "@/lib/agentSettlements";
import { z } from "zod";

/*
 * Agent-initiated settlement requests, across every agent.
 *
 * Sits alongside /api/admin/payout-agents/[id]; a static segment always wins
 * over a dynamic one in the App Router, and no agent id is ever the literal
 * string "settlements", so the two can't collide.
 */

/** GET — pending requests by default, `?view=all` for recent history. */
export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const all = req.nextUrl.searchParams.get("view") === "all";

  const requests = await prisma.agentPayoutRequest.findMany({
    where: all ? {} : { status: OPEN_SETTLEMENT_STATUS },
    orderBy: { createdAt: "desc" },
    take: all ? 100 : 50,
    select: {
      id: true, amount: true, method: true, account: true, accountName: true,
      status: true, adminNote: true, createdAt: true, paidAt: true,
      agent: { select: { id: true, name: true, username: true } },
    },
  });

  // What each agent is owed right now, so the admin can see a request that has
  // gone stale — the balance may have moved since it was filed.
  const outstanding = new Map<string, number>();
  for (const id of new Set(requests.map((r) => r.agent.id))) {
    outstanding.set(id, await agentOutstanding(id));
  }

  return NextResponse.json({
    requests: requests.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      method: r.method,
      account: r.account,
      accountName: r.accountName,
      status: r.status,
      adminNote: r.adminNote,
      createdAt: r.createdAt,
      paidAt: r.paidAt,
      agentId: r.agent.id,
      agentName: r.agent.name ?? r.agent.username,
      agentUsername: r.agent.username,
      agentOutstanding: outstanding.get(r.agent.id) ?? 0,
    })),
  });
}

const actionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["pay", "reject"]),
  note: z.string().trim().max(300).optional(),
});

/**
 * POST — pay or reject one request.
 *
 * Paying is what finally writes the SETTLEMENT ledger row, which is the only
 * thing that reduces what the agent is owed. The balance is re-checked inside
 * the transaction: a request filed yesterday may be larger than what's owed
 * today if an admin already used "Settle outstanding" in the meantime.
 */
export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { id, action, note } = parsed.data;
  const ip = getClientIp(req);

  const request = await prisma.agentPayoutRequest.findUnique({
    where: { id },
    select: { id: true, agentId: true, amount: true, status: true },
  });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.status !== OPEN_SETTLEMENT_STATUS) {
    return NextResponse.json({ error: `Already ${request.status.toLowerCase()}` }, { status: 409 });
  }

  if (action === "reject") {
    await prisma.agentPayoutRequest.update({
      where: { id },
      data: { status: "REJECTED", adminNote: note ?? "Rejected by admin" },
    });
    await logAdminAction({
      action: "REJECT_AGENT_PAYOUT", targetId: id, targetType: "AgentPayoutRequest",
      note, ipAddress: ip, metadata: { agentId: request.agentId, amount: Number(request.amount) },
    });
    return NextResponse.json({ success: true });
  }

  const amount = Number(request.amount);
  try {
    await prisma.$transaction(async (tx) => {
      const owed = await agentOutstanding(request.agentId, tx);
      if (amount > owed) {
        throw new Error(`OVER_BALANCE:${owed.toFixed(2)}`);
      }

      await tx.withdrawalAgentTxn.create({
        data: {
          agentId: request.agentId,
          type: "SETTLEMENT",
          amount,
          refId: id,
          note: note ?? "Settled agent payout request",
        },
      });
      await tx.agentPayoutRequest.update({
        where: { id },
        data: { status: "PAID", paidAt: new Date(), adminNote: note ?? "Paid by admin" },
      });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message.startsWith("OVER_BALANCE:")) {
      return NextResponse.json(
        { error: `Only ETB ${message.split(":")[1]} is owed now — reject this and ask for a fresh request.` },
        { status: 409 },
      );
    }
    throw e;
  }

  await logAdminAction({
    action: "PAY_AGENT_PAYOUT", targetId: id, targetType: "AgentPayoutRequest",
    note, ipAddress: ip, metadata: { agentId: request.agentId, amount },
  });
  return NextResponse.json({ success: true, settled: amount });
}
