import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { generateCredentials } from "@/lib/payoutAgents";
import { agentPosition } from "@/lib/agentLedger";
import { OPEN_WITHDRAWAL_STATUSES } from "@/lib/withdrawals";
import { z } from "zod";

/** GET — every payout agent with their live workload and money position. */
export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const [agents, openByAgent, ledger] = await Promise.all([
    prisma.withdrawalAgent.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.withdrawalRequest.groupBy({
      by: ["withdrawalAgentId"],
      where: { status: { in: [...OPEN_WITHDRAWAL_STATUSES] }, withdrawalAgentId: { not: null } },
      _count: { _all: true },
    }),
    prisma.withdrawalAgentTxn.groupBy({
      by: ["agentId", "type"],
      _sum: { amount: true },
    }),
  ]);

  const open = new Map(openByAgent.map((g) => [g.withdrawalAgentId, g._count._all]));

  return NextResponse.json({
    agents: agents.map((a) => {
      const pos = agentPosition(ledger.filter((l) => l.agentId === a.id));
      return {
        id: a.id,
        username: a.username,
        name: a.name,
        isActive: a.isActive,
        methods: a.methods,
        commissionRate: Number(a.commissionRate),
        isCashAgent: a.isCashAgent,
        slaMinutes: a.slaMinutes,
        maxWithdrawalEtb: a.maxWithdrawalEtb === null ? null : Number(a.maxWithdrawalEtb),
        contactType: a.contactType,
        contactHandle: a.contactHandle,
        createdAt: a.createdAt,
        openRequests: open.get(a.id) ?? 0,
        paidOut: pos.paidOut,
        commission: pos.commission,
        outstanding: pos.outstanding,
        float: pos.float,
        pendingCommission: pos.pendingCommission,
        cashIn: pos.cashIn,
        cashOut: pos.cashOut,
      };
    }),
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  methods: z.array(z.string().trim().min(1).max(40)).min(1, "Pick at least one method"),
  commissionRate: z.number().min(0).max(100),
  isCashAgent: z.boolean().optional(),
  slaMinutes: z.number().int().positive().max(10_080),
  // Omitted → no ceiling. Routing reads NULL as "any amount".
  maxWithdrawalEtb: z.number().positive().max(10_000_000).optional(),
  contactType: z.enum(["whatsapp", "telegram"]).optional(),
  contactHandle: z.string().trim().max(60).optional(),
});

/** POST — create an agent. Credentials are generated here and the password is
 *  returned exactly once; only its hash is stored. */
export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const { name, methods, commissionRate, isCashAgent, slaMinutes, maxWithdrawalEtb, contactType, contactHandle } = parsed.data;

  // Retry on the (vanishingly unlikely) username collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { username, password } = generateCredentials();
    const existing = await prisma.withdrawalAgent.findUnique({ where: { username }, select: { id: true } });
    if (existing) continue;

    const agent = await prisma.withdrawalAgent.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(password, 10),
        name,
        methods,
        commissionRate,
        isCashAgent: isCashAgent ?? false,
        slaMinutes,
        maxWithdrawalEtb: maxWithdrawalEtb ?? null,
        contactType: contactType ?? null,
        contactHandle: contactHandle || null,
      },
      select: { id: true },
    });

    await logAdminAction({
      action: "CREATE_PAYOUT_AGENT",
      targetId: agent.id,
      targetType: "WithdrawalAgent",
      ipAddress: getClientIp(req),
      metadata: { username, methods, commissionRate, slaMinutes, maxWithdrawalEtb: maxWithdrawalEtb ?? null },
    });

    // The only time the plaintext password ever leaves this server.
    return NextResponse.json({ success: true, id: agent.id, username, password });
  }

  return NextResponse.json({ error: "Could not allocate a username — try again" }, { status: 500 });
}
