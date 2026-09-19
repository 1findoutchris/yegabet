import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAdminSecret, adminUnauthorized } from "@/lib/adminAuth";
import { verifyAdminSession, ADMIN_COOKIE } from "@/lib/adminSession";
import { dayKey, resolveRange } from "@/lib/adminRange";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret") ?? "";
  if (!verifyAdminSecret(secret)) return adminUnauthorized();

  const token = req.cookies.get(ADMIN_COOKIE)?.value ?? "";
  const username = await verifyAdminSession(token);
  if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const { period, from, to } = resolveRange(searchParams);

  // All completed transactions in range
  const transactions = await prisma.transaction.findMany({
    where: {
      type: { in: ["DEPOSIT", "WITHDRAWAL", "BONUS"] },
      status: "COMPLETED",
      createdAt: { gte: from, lte: to },
    },
    orderBy: { createdAt: "asc" },
    select: { type: true, amount: true, createdAt: true, metadata: true },
  });

  // BONUS is overloaded: grantBonus writes real promo credit (cashback, streak,
  // spin prizes, deposit match), but admin balance adjustments reuse the type
  // too. Only the former is "bonus given", so admin_adjust rows are dropped.
  // Zero-amount rows (points-only challenge claims) are dropped as well so they
  // don't pad the grant count with grants worth nothing.
  const isBonusGiven = (t: (typeof transactions)[number]) =>
    t.type === "BONUS" &&
    Number(t.amount) > 0 &&
    (t.metadata as { kind?: string } | null)?.kind !== "admin_adjust";

  // Totals
  let totalDeposited = 0, depositCount = 0;
  let totalWithdrawn = 0, withdrawalCount = 0;
  let totalBonus = 0, bonusCount = 0;

  for (const t of transactions) {
    const amt = Number(t.amount);
    if (t.type === "DEPOSIT") { totalDeposited += amt; depositCount++; }
    else if (t.type === "WITHDRAWAL") { totalWithdrawn += amt; withdrawalCount++; }
    else if (isBonusGiven(t)) { totalBonus += amt; bonusCount++; }
  }

  // Per-day breakdown
  const emptyDay = () => ({ deposits: 0, withdrawals: 0, bonus: 0, depositCount: 0, withdrawalCount: 0, bonusCount: 0 });
  const dayMap = new Map<string, ReturnType<typeof emptyDay>>();

  for (const t of transactions) {
    const day = dayKey(t.createdAt);
    if (!dayMap.has(day)) dayMap.set(day, emptyDay());
    const entry = dayMap.get(day)!;
    const amt = Number(t.amount);
    if (t.type === "DEPOSIT") { entry.deposits += amt; entry.depositCount++; }
    else if (t.type === "WITHDRAWAL") { entry.withdrawals += amt; entry.withdrawalCount++; }
    else if (isBonusGiven(t)) { entry.bonus += amt; entry.bonusCount++; }
  }

  // Fill gaps between from → to
  const days: (ReturnType<typeof emptyDay> & { date: string; net: number })[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= to) {
    const day = dayKey(cursor);
    const entry = dayMap.get(day) ?? emptyDay();
    days.push({ date: day, ...entry, net: entry.deposits - entry.withdrawals });
    cursor.setDate(cursor.getDate() + 1);
  }

  // Top depositors in period
  const topDepositors = await prisma.transaction.groupBy({
    by: ["userId"],
    where: { type: "DEPOSIT", status: "COMPLETED", createdAt: { gte: from, lte: to } },
    _sum: { amount: true },
    _count: true,
    orderBy: { _sum: { amount: "desc" } },
    take: 10,
  });

  const userIds = topDepositors.map((d) => d.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, name: true, phone: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json({
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    totals: {
      deposited: totalDeposited, depositCount,
      withdrawn: totalWithdrawn, withdrawalCount,
      bonus: totalBonus, bonusCount,
      // Bonus is deliberately not subtracted here — `net` stays deposits −
      // withdrawals, the cash figure. Bonus credit only becomes a real cost
      // once it is staked and withdrawn, which shows up as a withdrawal.
      net: totalDeposited - totalWithdrawn,
    },
    days,
    topDepositors: topDepositors.map((d) => ({
      userId: d.userId,
      username: userMap.get(d.userId)?.name || userMap.get(d.userId)?.username || "—",
      phone: userMap.get(d.userId)?.phone ?? "—",
      amount: Number(d._sum.amount ?? 0),
      count: d._count,
    })),
  });
}
