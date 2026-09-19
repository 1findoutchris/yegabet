import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isoWeekStart } from "@/lib/loyalty";
import { TransactionType } from "@prisma/client";

const TOP = 20;
// Ledger amount for display, e.g. "ETB 1,900".
const money = (n: number) => `ETB ${Math.round(n).toLocaleString("en-US")}`;

// Show only the front half of the name and mask the rest for privacy,
// e.g. "Temesgen" → "Teme••••", "Abel" → "Ab••".
function maskName(name: string): string {
  const visible = Math.max(1, Math.ceil(name.length / 2));
  return name.slice(0, visible) + "•".repeat(name.length - visible);
}

// First name only (never expose username — it embeds the phone number), masked.
function firstName(name: string | null): string {
  const f = name?.trim().split(/\s+/)[0];
  return f && f.length >= 2 ? maskName(f) : "Player";
}

interface Entry { rank: number; label: string; value: string; you: boolean }

// Rank users by an aggregate over this week's transactions (sum or max amount).
async function txBoard(
  type: TransactionType,
  agg: "sum" | "max",
  me: string,
): Promise<Entry[]> {
  const since = isoWeekStart();
  const where = { type, createdAt: { gte: since } };

  let rows: { userId: string; value: number }[];
  if (agg === "sum") {
    const groups = await prisma.transaction.groupBy({
      by: ["userId"], where, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } },
    });
    rows = groups.map((g) => ({ userId: g.userId, value: Number(g._sum.amount ?? 0) }));
  } else {
    const groups = await prisma.transaction.groupBy({
      by: ["userId"], where, _max: { amount: true }, orderBy: { _max: { amount: "desc" } },
    });
    rows = groups.map((g) => ({ userId: g.userId, value: Number(g._max.amount ?? 0) }));
  }

  const top = rows.slice(0, TOP);
  const ids = top.map((r) => r.userId);
  if (me && !ids.includes(me)) ids.push(me);
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const entries: Entry[] = top.map((r, i) => ({
    rank: i + 1,
    label: r.userId === me ? "You" : firstName(nameById.get(r.userId) ?? null),
    value: money(r.value),
    you: r.userId === me,
  }));

  // Append the player's own row if they're outside the top.
  const myIndex = rows.findIndex((r) => r.userId === me);
  if (myIndex >= TOP) {
    entries.push({ rank: myIndex + 1, label: "You", value: money(rows[myIndex].value), you: true });
  }
  return entries;
}

// Rank users by all-time loyalty points.
async function pointsBoard(me: string): Promise<Entry[]> {
  const top = await prisma.user.findMany({
    where: { loyaltyPoints: { gt: 0 } },
    orderBy: { loyaltyPoints: "desc" },
    take: TOP,
    select: { id: true, name: true, loyaltyPoints: true },
  });

  const entries: Entry[] = top.map((u, i) => ({
    rank: i + 1,
    label: u.id === me ? "You" : firstName(u.name),
    value: `${u.loyaltyPoints.toLocaleString("en-US")} pts`,
    you: u.id === me,
  }));

  if (me && !top.some((u) => u.id === me)) {
    const meUser = await prisma.user.findUnique({ where: { id: me }, select: { loyaltyPoints: true } });
    const myPts = meUser?.loyaltyPoints ?? 0;
    if (myPts > 0) {
      const ahead = await prisma.user.count({ where: { loyaltyPoints: { gt: myPts } } });
      entries.push({ rank: ahead + 1, label: "You", value: `${myPts.toLocaleString("en-US")} pts`, you: true });
    }
  }
  return entries;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const me = session.user.id;
  const [volume, points, wins] = await Promise.all([
    txBoard("BET", "sum", me),
    pointsBoard(me),
    txBoard("WIN", "max", me),
  ]);

  return NextResponse.json({
    boards: [
      { id: "volume", title: "Top Bettors",     metric: "Total wagered this week", entries: volume },
      { id: "points", title: "Loyalty Leaders", metric: "Loyalty points (all-time)", entries: points },
      { id: "wins",   title: "Biggest Wins",    metric: "Biggest single win this week", entries: wins },
    ],
  });
}
