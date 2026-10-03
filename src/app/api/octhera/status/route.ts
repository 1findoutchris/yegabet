import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOctheraTester } from "@/lib/octheraAccess";
import { OctheraError, getBalance } from "@/lib/providers/octhera";
import { octheraCatalogStatus } from "@/lib/games";

/**
 * GET — the tester's Octhera balance (null until first launch registers
 * them) and their latest webhook events, so a test round can be checked
 * end to end from the page. `catalog` says whether Octhera's game list
 * (OCTHERA_GAMES_PUBLIC) loaded, how many games, and the last error.
 */
export async function GET() {
  const access = await requireOctheraTester();
  if (access instanceof NextResponse) return access;

  let balance: { balance: number; currency: string } | null = null;
  let balanceError: string | null = null;
  try {
    balance = await getBalance(access.username);
  } catch (e) {
    if (!(e instanceof OctheraError && e.status === 404)) {
      balanceError = e instanceof OctheraError ? `Octhera: ${e.providerMessage}` : "Could not reach Octhera";
    }
  }

  const events = await prisma.octheraEvent.findMany({
    where: { username: access.username },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      txnId: true, action: true, betAmount: true, winAmount: true, amount: true,
      balance: true, currency: true, gameName: true, createdAt: true,
    },
  });

  const catalog = await octheraCatalogStatus();

  return NextResponse.json({ username: access.username, balance, balanceError, events, catalog });
}
