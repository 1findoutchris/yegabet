import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { generateCredentials } from "@/lib/payoutAgents";
import { agentPosition, FLOAT_TYPES } from "@/lib/agentLedger";
import { roundETB } from "@/lib/utils";
import { slaState } from "@/lib/payoutRouting";
import { OPEN_WITHDRAWAL_STATUSES } from "@/lib/withdrawals";
import { z } from "zod";

/** GET — one agent, their performance stats and their recent requests. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const agent = await prisma.withdrawalAgent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [requests, ledger, floatLedger] = await Promise.all([
    prisma.withdrawalRequest.findMany({
      where: { withdrawalAgentId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, publicId: true, amount: true, method: true, status: true,
        assignedAt: true, paidAt: true, processingAt: true, createdAt: true,
        adminNote: true,
        user: { select: { username: true } },
      },
    }),
    prisma.withdrawalAgentTxn.groupBy({
      by: ["type"],
      where: { agentId: id },
      _sum: { amount: true },
    }),
    // Cash-rail rows only — the payout rail already has its own history screen.
    prisma.withdrawalAgentTxn.findMany({
      where: { agentId: id, type: { in: [...FLOAT_TYPES] } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, amount: true, note: true, refId: true, createdAt: true },
    }),
  ]);

  const now = new Date();
  const withSla = requests.map((r) => ({
    id: r.id,
    publicId: r.publicId,
    amount: Number(r.amount),
    method: r.method,
    status: r.status,
    username: r.user.username,
    createdAt: r.createdAt,
    paidAt: r.paidAt,
    adminNote: r.adminNote,
    sla: slaState(r.assignedAt, r.paidAt, agent.slaMinutes, now),
  }));

  // Stats measured on settled work only — a request still in the queue hasn't
  // earned a verdict yet, and counting it would make every agent look slow the
  // moment they get busy.
  const settledRows = withSla.filter((r) => r.status === "APPROVED");
  const times = settledRows.map((r) => r.sla?.elapsedMinutes ?? 0);
  const breaches = withSla.filter((r) => r.sla?.breached).length;

  const pos = agentPosition(ledger);

  return NextResponse.json({
    id: agent.id,
    username: agent.username,
    name: agent.name,
    isActive: agent.isActive,
    methods: agent.methods,
    commissionRate: Number(agent.commissionRate),
    isCashAgent: agent.isCashAgent,
    slaMinutes: agent.slaMinutes,
    maxWithdrawalEtb: agent.maxWithdrawalEtb === null ? null : Number(agent.maxWithdrawalEtb),
    contactType: agent.contactType,
    contactHandle: agent.contactHandle,
    createdAt: agent.createdAt,
    stats: {
      open: withSla.filter((r) => OPEN_WITHDRAWAL_STATUSES.includes(r.status as "PENDING" | "PROCESSING")).length,
      completed: settledRows.length,
      rejected: withSla.filter((r) => r.status === "REJECTED").length,
      breaches,
      avgMinutes: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
      slowestMinutes: times.length ? Math.max(...times) : null,
      paidOut: pos.paidOut,
      commission: pos.commission,
      outstanding: pos.outstanding,
      toppedUp: pos.toppedUp,
      cashIn: pos.cashIn,
      cashOut: pos.cashOut,
      float: pos.float,
    },
    requests: withSla,
    floatLedger: floatLedger.map((r) => ({ ...r, amount: Number(r.amount) })),
  });
}

const patchSchema = z.object({
  action: z.enum(["update", "activate", "deactivate", "reset-password", "settle", "topup"]),
  name: z.string().trim().min(1).max(60).optional(),
  methods: z.array(z.string().trim().min(1).max(40)).min(1).optional(),
  commissionRate: z.number().min(0).max(100).optional(),
  isCashAgent: z.boolean().optional(),
  // topup only. Positive hands the agent spendable float against cash they have
  // paid in; negative books a FLOAT_RETURN, which is the only way to undo a
  // mistyped top-up without editing rows by hand.
  amount: z.number().refine((n) => n !== 0, "Amount cannot be zero")
    .refine((n) => Math.abs(n) <= 10_000_000, "Amount too large").optional(),
  slaMinutes: z.number().int().positive().max(10_080).optional(),
  // null clears the ceiling back to "any amount".
  maxWithdrawalEtb: z.number().positive().max(10_000_000).nullable().optional(),
  contactType: z.enum(["whatsapp", "telegram"]).nullable().optional(),
  contactHandle: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(200).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { action, note, amount, ...fields } = parsed.data;
  const ip = getClientIp(req);

  const agent = await prisma.withdrawalAgent.findUnique({
    where: { id },
    select: { id: true, username: true, isCashAgent: true },
  });
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "update") {
    await prisma.withdrawalAgent.update({
      where: { id },
      data: {
        ...(fields.name !== undefined ? { name: fields.name } : {}),
        ...(fields.methods !== undefined ? { methods: fields.methods } : {}),
        ...(fields.commissionRate !== undefined ? { commissionRate: fields.commissionRate } : {}),
        ...(fields.isCashAgent !== undefined ? { isCashAgent: fields.isCashAgent } : {}),
        ...(fields.slaMinutes !== undefined ? { slaMinutes: fields.slaMinutes } : {}),
        ...(fields.maxWithdrawalEtb !== undefined ? { maxWithdrawalEtb: fields.maxWithdrawalEtb } : {}),
        ...(fields.contactType !== undefined ? { contactType: fields.contactType } : {}),
        ...(fields.contactHandle !== undefined ? { contactHandle: fields.contactHandle || null } : {}),
      },
    });
    await logAdminAction({ action: "UPDATE_PAYOUT_AGENT", targetId: id, targetType: "WithdrawalAgent", ipAddress: ip, metadata: fields });
    return NextResponse.json({ success: true });
  }

  if (action === "activate" || action === "deactivate") {
    // A deactivated agent stops receiving new routing but keeps whatever is
    // already assigned — reassign those from the withdrawals screen.
    await prisma.withdrawalAgent.update({ where: { id }, data: { isActive: action === "activate" } });
    await logAdminAction({ action: `${action.toUpperCase()}_PAYOUT_AGENT`, targetId: id, targetType: "WithdrawalAgent", ipAddress: ip });
    return NextResponse.json({ success: true });
  }

  if (action === "reset-password") {
    const { password } = generateCredentials();
    await prisma.withdrawalAgent.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    await logAdminAction({ action: "RESET_PAYOUT_AGENT_PASSWORD", targetId: id, targetType: "WithdrawalAgent", ipAddress: ip });
    // Shown once, never stored in plaintext.
    return NextResponse.json({ success: true, username: agent.username, password });
  }

  if (action === "topup") {
    if (amount === undefined) return NextResponse.json({ error: "amount required" }, { status: 400 });
    if (!agent.isCashAgent) {
      return NextResponse.json({ error: "Not a cash agent — enable the cash rail first" }, { status: 400 });
    }

    const rows = await prisma.withdrawalAgentTxn.groupBy({
      by: ["type"], where: { agentId: id }, _sum: { amount: true },
    });
    const before = agentPosition(rows).float;

    // Taking float back can't overdraw it — the agent would owe credit they
    // have already handed to players, which the ledger has no way to unwind.
    if (amount < 0 && before + amount < 0) {
      return NextResponse.json(
        { error: `Can only take back ${before.toFixed(2)} — that is all the float left` },
        { status: 400 },
      );
    }

    await prisma.withdrawalAgentTxn.create({
      data: {
        agentId: id,
        type: amount > 0 ? "TOPUP" : "FLOAT_RETURN",
        amount: Math.abs(amount),
        note: note ?? (amount > 0 ? "Float top-up by admin" : "Float returned to admin"),
      },
    });
    await logAdminAction({
      action: amount > 0 ? "TOPUP_CASH_AGENT" : "RETURN_CASH_AGENT_FLOAT",
      targetId: id, targetType: "WithdrawalAgent", note: note ?? undefined, ipAddress: ip,
      metadata: { amount, floatBefore: before, floatAfter: roundETB(before + amount) },
    });
    return NextResponse.json({ success: true, float: roundETB(before + amount) });
  }

  // settle — books a SETTLEMENT row for everything outstanding, zeroing what
  // the platform owes this agent.
  const ledger = await prisma.withdrawalAgentTxn.groupBy({
    by: ["type"],
    where: { agentId: id },
    _sum: { amount: true },
  });
  const { outstanding } = agentPosition(ledger);

  if (outstanding <= 0) {
    return NextResponse.json({ error: "Nothing outstanding to settle" }, { status: 400 });
  }

  await prisma.withdrawalAgentTxn.create({
    data: { agentId: id, type: "SETTLEMENT", amount: outstanding, note: note ?? "Settled by admin" },
  });
  await logAdminAction({
    action: "SETTLE_PAYOUT_AGENT", targetId: id, targetType: "WithdrawalAgent",
    note: note ?? undefined, ipAddress: ip, metadata: { outstanding },
  });
  return NextResponse.json({ success: true, settled: outstanding });
}

/**
 * Remove an agent entirely — for one created by mistake, or who never started.
 *
 * Refused the moment they have any history. Their id is what says who paid a
 * given withdrawal and what the platform owed them; deleting the row would
 * either orphan those records or quietly rewrite them, and neither is worth it
 * when deactivating already takes them out of routing for good.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const agent = await prisma.withdrawalAgent.findUnique({
    where: { id },
    select: { id: true, username: true, name: true },
  });
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [requests, ledgerRows] = await Promise.all([
    prisma.withdrawalRequest.count({ where: { withdrawalAgentId: id } }),
    prisma.withdrawalAgentTxn.count({ where: { agentId: id } }),
  ]);

  if (requests > 0 || ledgerRows > 0) {
    return NextResponse.json(
      {
        error: `This agent has handled ${requests} withdrawal${requests === 1 ? "" : "s"} — deleting would erase who paid them. Deactivate instead.`,
      },
      { status: 400 },
    );
  }

  await prisma.withdrawalAgent.delete({ where: { id } });
  await logAdminAction({
    action: "DELETE_PAYOUT_AGENT",
    targetId: id,
    targetType: "WithdrawalAgent",
    ipAddress: getClientIp(req),
    metadata: { username: agent.username, name: agent.name },
  });

  return NextResponse.json({ success: true });
}
