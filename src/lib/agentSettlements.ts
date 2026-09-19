import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/*
 * Agent settlement requests — an agent asking to be paid what the platform owes
 * them, and the admin paying it.
 *
 * The money rule lives here rather than in either route, because both sides
 * need the same answer to "what are they owed": the agent to be stopped from
 * over-requesting, and the admin to be stopped from over-paying a request that
 * was filed when the balance was higher.
 */

/** Statuses a request can still move out of. */
export const OPEN_SETTLEMENT_STATUS = "PENDING";

/**
 * What the platform currently owes an agent: everything booked since the last
 * settlement. Same arithmetic as the admin agent list — no float column exists,
 * so this is always derived.
 */
export async function agentOutstanding(
  agentId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const ledger = await client.withdrawalAgentTxn.groupBy({
    by: ["type"],
    where: { agentId },
    _sum: { amount: true },
  });
  const sum = (type: string) =>
    Number(ledger.find((l) => l.type === type)?._sum.amount ?? 0);
  return Math.round((sum("PAYOUT") + sum("COMMISSION") - sum("SETTLEMENT")) * 100) / 100;
}
