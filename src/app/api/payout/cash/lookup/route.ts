import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { requirePayoutAuth } from "@/lib/payoutAuth";

/**
 * Account number → the name the agent should read back to the customer.
 *
 * This is an enumeration surface: account numbers are 9 digits and sequentialish
 * in appearance, so an agent who scripted it could harvest the customer list.
 * Hence three limits — agent auth, a per-agent hourly budget, and a response
 * carrying only what's needed to confirm "yes, that's me": no phone, no email,
 * no balance.
 */
const LOOKUPS_PER_HOUR = 120;

export async function GET(req: NextRequest) {
  const auth = await requirePayoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const raw = req.nextUrl.searchParams.get("accountNo") ?? "";
  const accountNo = Number(raw.trim());
  if (!Number.isInteger(accountNo) || accountNo <= 0) {
    return NextResponse.json({ error: "Enter a valid account ID" }, { status: 400 });
  }

  const key = `cash:lookup:${auth.agentId}:${new Date().toISOString().slice(0, 13)}`;
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 3600);
  if (used > LOOKUPS_PER_HOUR) {
    return NextResponse.json({ error: "Too many lookups — try again later" }, { status: 429 });
  }

  const agent = await prisma.withdrawalAgent.findUnique({
    where: { id: auth.agentId },
    select: { isCashAgent: true },
  });
  if (!agent?.isCashAgent) {
    return NextResponse.json({ error: "Not a cash agent" }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { accountNo },
    select: { name: true, username: true, isActive: true },
  });
  // Same shape for "no such account" and "banned account" — an agent has no
  // reason to learn which, and the difference would leak who is banned.
  if (!user || !user.isActive) {
    return NextResponse.json({ error: "No account with that ID" }, { status: 404 });
  }

  return NextResponse.json({ accountNo, name: user.name || user.username });
}
