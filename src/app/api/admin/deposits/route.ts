import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth } from "@/lib/adminAuth";

export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "PENDING";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = 20;

  const where = status === "ALL" ? {} : { status };

  const [items, total] = await Promise.all([
    prisma.depositRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { id: true, accountNo: true, username: true, name: true, phone: true } } },
    }),
    prisma.depositRequest.count({ where }),
  ]);

  return NextResponse.json({
    items: items.map((d) => ({
      id: d.id,
      userId: d.userId,
      accountNo: d.user.accountNo,
      username: d.user.username,
      name: d.user.name,
      phone: d.user.phone,
      amount: Number(d.amount),
      method: d.method,
      receiptText: d.receiptText,
      smsRef: d.smsRef,
      status: d.status,
      adminNote: d.adminNote,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}
