import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";

/**
 * GET — one agent's full picture: profile, ticket list (with bets), recent
 * transactions, and money stats.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const agent = await prisma.user.findFirst({
    where: { id, role: "IN_PERSON_AGENT" },
    select: {
      id: true, username: true, name: true, phone: true, isActive: true,
      commissionRate: true, balance: true, depositBalance: true, bonusBalance: true,
      createdAt: true,
    },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const [tickets, transactions, commission] = await Promise.all([
    prisma.ticket.findMany({
      where: { agentId: id },
      include: { bets: { select: { betAmount: true, winAmount: true, settled: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.transaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, type: true, status: true, amount: true,
        balanceAfter: true, reference: true, createdAt: true,
      },
    }),
    prisma.transaction.aggregate({
      where: { userId: id, type: "COMMISSION", status: "COMPLETED" },
      _sum: { amount: true },
    }),
  ]);

  return NextResponse.json({
    agent: {
      ...agent,
      balance: Number(agent.balance),
      depositBalance: Number(agent.depositBalance),
      bonusBalance: Number(agent.bonusBalance),
      commissionRate: Number(agent.commissionRate ?? 0),
      commissionEarned: Number(commission._sum.amount ?? 0),
    },
    tickets,
    transactions,
  });
}

const patchSchema = z.object({
  commissionRate: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  name: z.string().trim().min(2).max(80).optional(),
});

/** PATCH — update commission rate, activate/deactivate, or rename. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const agent = await prisma.user.findFirst({ where: { id, role: "IN_PERSON_AGENT" }, select: { id: true } });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const updated = await prisma.user.update({
    where: { id },
    data: parsed.data,
    select: { id: true, username: true, name: true, isActive: true, commissionRate: true },
  });

  await logAdminAction({
    action: "in_person_agent.update",
    targetId: id,
    targetType: "user",
    metadata: parsed.data,
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ agent: updated });
}
