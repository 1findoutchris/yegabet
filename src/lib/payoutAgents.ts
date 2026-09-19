import "server-only";
import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { roundETB } from "./utils";
import { pickLeastLoaded, type AgentLoad } from "./payoutRouting";

/*
 * Payout agents — the automatic (ETB) withdrawal rail.
 *
 * They hold no float: they pay players from their own funds, and the platform
 * records a PAYOUT (what it owes them) plus a COMMISSION row. The outstanding
 * amount is the sum of those since the last SETTLEMENT.
 */

/** Statuses that still occupy an agent — used to measure their live workload. */
export const OPEN_STATUSES = ["PENDING", "PROCESSING"] as const;

/** Unambiguous alphabet: no O/0, I/1, S/5, so codes survive being read aloud
 *  over the phone, which is exactly how an admin will quote them to an agent. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";

function randomCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/**
 * A short, quotable id for a withdrawal request ("W-3F9K2A"). Retries on the
 * unique constraint; 30^6 ≈ 729M keeps collisions vanishingly rare.
 */
export async function generatePublicId(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `W-${randomCode(6)}`;
    const clash = await tx.withdrawalRequest.findUnique({
      where: { publicId: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  // Astronomically unlikely; fall back to something guaranteed unique rather
  // than failing the player's withdrawal.
  return `W-${randomCode(10)}`;
}

/** Auto-generated agent credentials. The password is shown to the admin once
 *  at creation and only ever stored hashed. */
export function generateCredentials(): { username: string; password: string } {
  return {
    username: `pay_${randomCode(6).toLowerCase()}`,
    password: randomCode(12),
  };
}

/**
 * Route a new request to the payout agent handling that method with the least
 * open work. Returns null when nobody covers the method — the request then
 * simply waits in the admin queue rather than failing the player's withdrawal.
 *
 * An agent with a `maxWithdrawalEtb` ceiling is only eligible for amounts at or
 * under it, so a big payout skips the small-float agents instead of parking in
 * a queue they can't clear. A NULL ceiling means no limit.
 */
export async function assignPayoutAgent(
  tx: Prisma.TransactionClient,
  method: string,
  amountETB: number,
): Promise<string | null> {
  const agents = await tx.withdrawalAgent.findMany({
    where: {
      isActive: true,
      methods: { has: method },
      OR: [{ maxWithdrawalEtb: null }, { maxWithdrawalEtb: { gte: amountETB } }],
    },
    select: { id: true },
  });
  if (agents.length === 0) return null;

  // Counted with a groupBy rather than a filtered `_count` include, which isn't
  // available across all Prisma versions in use here.
  const grouped = await tx.withdrawalRequest.groupBy({
    by: ["withdrawalAgentId"],
    where: { status: { in: [...OPEN_STATUSES] }, withdrawalAgentId: { not: null } },
    _count: { _all: true },
  });
  const openByAgent = new Map(grouped.map((g) => [g.withdrawalAgentId, g._count._all]));

  const load: AgentLoad[] = agents.map((a) => ({ id: a.id, open: openByAgent.get(a.id) ?? 0 }));
  return pickLeastLoaded(load);
}

/**
 * Record a completed payout: what the platform now owes the agent, plus their
 * commission on it. Runs inside the caller's transaction.
 */
export async function recordPayout(
  tx: Prisma.TransactionClient,
  agentId: string,
  amountETB: number,
  commissionRate: number,
  requestId: string,
): Promise<{ commission: number }> {
  const commission = roundETB((amountETB * commissionRate) / 100);

  await tx.withdrawalAgentTxn.create({
    data: { agentId, type: "PAYOUT", amount: amountETB, refId: requestId, note: "Withdrawal paid to player" },
  });
  if (commission > 0) {
    await tx.withdrawalAgentTxn.create({
      data: { agentId, type: "COMMISSION", amount: commission, refId: requestId, note: `${commissionRate}% of ${amountETB}` },
    });
  }
  return { commission };
}
