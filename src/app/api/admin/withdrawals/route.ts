import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth } from "@/lib/adminAuth";
import { slaState } from "@/lib/payoutRouting";

export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "PENDING";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = 20;

  const where = status === "ALL" ? {} : { status };

  const [items, total] = await Promise.all([
    prisma.withdrawalRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { id: true, accountNo: true, username: true, name: true, phone: true } },
        withdrawalAgent: { select: { id: true, name: true, username: true, slaMinutes: true } },
      },
    }),
    prisma.withdrawalRequest.count({ where }),
  ]);

  const now = new Date();
  return NextResponse.json({
    items: items.map((w) => ({
      id: w.id,
      // Short quotable code — this is what the admin references when asking an
      // agent why a payout was delayed.
      publicId: w.publicId,
      userId: w.userId,
      agentId: w.withdrawalAgent?.id ?? null,
      agentName: w.withdrawalAgent?.name ?? w.withdrawalAgent?.username ?? null,
      sla: slaState(w.assignedAt, w.paidAt, w.withdrawalAgent?.slaMinutes ?? 0, now),
      accountNo: w.user.accountNo,
      username: w.user.username,
      name: w.user.name,
      phone: w.user.phone,
      amount: Number(w.amount),
      hasProof: !!w.proofKey && !!w.proofExpiresAt && w.proofExpiresAt > new Date(),
      method: w.method,
      account: w.account,
      accountName: w.accountName,
      status: w.status,
      adminNote: w.adminNote,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}
