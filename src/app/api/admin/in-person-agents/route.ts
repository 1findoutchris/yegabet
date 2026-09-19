import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { generateCredentials } from "@/lib/payoutAgents";

/**
 * GET — every in-person betting agent with live stats: tickets, stake volume,
 * commission earned, and what the platform currently owes them (their
 * withdrawable balance is theirs; "owed" here means commission earned to date
 * plus pending withdrawal requests).
 */
export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const [agents, ticketStats, commissions, pendingWithdrawals] = await Promise.all([
    prisma.user.findMany({
      where: { role: "IN_PERSON_AGENT" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, username: true, name: true, phone: true, isActive: true,
        commissionRate: true, balance: true, depositBalance: true, bonusBalance: true,
        createdAt: true,
      },
    }),
    prisma.ticket.groupBy({
      by: ["agentId", "status"],
      _count: { _all: true },
      _sum: { totalStake: true, totalWin: true },
    }),
    prisma.transaction.groupBy({
      by: ["userId"],
      where: { type: "COMMISSION", status: "COMPLETED" },
      _sum: { amount: true },
    }),
    prisma.withdrawalRequest.groupBy({
      by: ["userId"],
      where: { status: { in: ["PENDING", "PROCESSING"] } },
      _sum: { amount: true },
    }),
  ]);

  const commissionByUser = new Map(commissions.map((c) => [c.userId, Number(c._sum.amount ?? 0)]));
  const pendingByUser = new Map(pendingWithdrawals.map((w) => [w.userId, Number(w._sum.amount ?? 0)]));

  const statsByAgent = new Map<string, { tickets: number; staked: number; won: number; paid: number }>();
  for (const row of ticketStats) {
    const s = statsByAgent.get(row.agentId) ?? { tickets: 0, staked: 0, won: 0, paid: 0 };
    s.tickets += row._count._all;
    s.staked += Number(row._sum.totalStake ?? 0);
    if (row.status === "WON" || row.status === "PAID") s.won += Number(row._sum.totalWin ?? 0);
    if (row.status === "PAID") s.paid += Number(row._sum.totalWin ?? 0);
    statsByAgent.set(row.agentId, s);
  }

  return NextResponse.json({
    agents: agents.map((a) => {
      const s = statsByAgent.get(a.id) ?? { tickets: 0, staked: 0, won: 0, paid: 0 };
      return {
        ...a,
        balance: Number(a.balance),
        commissionRate: Number(a.commissionRate ?? 0),
        commissionEarned: commissionByUser.get(a.id) ?? 0,
        pendingWithdrawal: pendingByUser.get(a.id) ?? 0,
        ...s,
      };
    }),
  });
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(20),
  commissionRate: z.number().min(0).max(100),
});

/**
 * POST — create an in-person agent. They're a User with role IN_PERSON_AGENT:
 * the phone is the login identifier (normal credentials auth), username and
 * password are generated here and shown ONCE — hand them to the agent.
 */
export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Name, phone and commission rate are required" }, { status: 400 });
  }

  const phoneTaken = await prisma.user.findUnique({
    where: { phone: parsed.data.phone },
    select: { id: true },
  });
  if (phoneTaken) {
    return NextResponse.json({ error: "That phone number is already registered" }, { status: 409 });
  }

  // Retry on the (vanishingly unlikely) generated-username collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { username, password } = generateCredentials();
    const clash = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (clash) continue;

    const agent = await prisma.user.create({
      data: {
        username,
        name: parsed.data.name,
        phone: parsed.data.phone,
        passwordHash: await bcrypt.hash(password, 10),
        role: "IN_PERSON_AGENT",
        isVerified: true, // admin-created — no OTP step
        commissionRate: parsed.data.commissionRate,
      },
      select: { id: true, username: true, name: true, phone: true },
    });

    await logAdminAction({
      action: "in_person_agent.create",
      targetId: agent.id,
      targetType: "user",
      metadata: {
        username: agent.username,
        phone: agent.phone,
        commissionRate: parsed.data.commissionRate,
      },
      ipAddress: getClientIp(req),
    });

    // Password is returned once — it is never retrievable again.
    return NextResponse.json({ agent, password }, { status: 201 });
  }

  return NextResponse.json({ error: "Could not allocate a username — retry" }, { status: 500 });
}
