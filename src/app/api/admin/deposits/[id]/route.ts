import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { approveDeposit } from "@/lib/deposits";
import { roundETB } from "@/lib/utils";
import { z } from "zod";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().optional(),
  amount: z.number().positive().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { action, note, amount: overrideAmount } = parsed.data;

  const deposit = await prisma.depositRequest.findUnique({
    where: { id },
    include: { user: { select: { id: true, username: true, balance: true } } },
  });

  if (!deposit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (deposit.status !== "PENDING") {
    return NextResponse.json({ error: "Already processed" }, { status: 409 });
  }

  const ip = getClientIp(req);

  if (action === "approve") {
    const amount = overrideAmount ?? Number(deposit.amount);
    const ref = deposit.smsRef ?? `manual-${id}`;
    await approveDeposit(id, deposit.userId, amount, ref);
    await logAdminAction({
      action: "APPROVE_DEPOSIT",
      targetId: id,
      targetType: "DepositRequest",
      note: note ?? undefined,
      ipAddress: ip,
      metadata: { userId: deposit.userId, amount },
    });
    return NextResponse.json({ success: true });
  }

  // reject
  await prisma.depositRequest.update({
    where: { id },
    data: { status: "REJECTED", adminNote: note ?? "Rejected by admin" },
  });
  await logAdminAction({
    action: "REJECT_DEPOSIT",
    targetId: id,
    targetType: "DepositRequest",
    note: note ?? undefined,
    ipAddress: ip,
    metadata: { userId: deposit.userId, amount: Number(deposit.amount) },
  });
  return NextResponse.json({ success: true });
}
