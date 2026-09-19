import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { putObject, storageConfigured } from "./storage";

/*
 * Shared withdrawal settlement, used by the admin, cashier-agent, payout-agent
 * and player-cancel paths so they can't drift apart.
 */

/** Statuses a withdrawal can still be approved, rejected or cancelled from.
 *  PROCESSING means an agent has committed to sending the money — the player
 *  can no longer cancel, but staff can still finish or reject it. */
export const OPEN_WITHDRAWAL_STATUSES = ["PENDING", "PROCESSING"] as const;

export interface SettleTarget {
  userId: string;
  amount: Prisma.Decimal | number;
  txnReference: string | null;
}

/**
 * Close out the PENDING ledger row that reserved a withdrawal's funds.
 *
 * Matching on the stored reference is the point: the previous
 * `updateMany({ userId, type, status, amount })` closed EVERY pending
 * withdrawal of the same amount, so a player with two identical requests could
 * have both settled by a decision on one of them.
 */
export async function closeWithdrawalTxn(
  tx: Prisma.TransactionClient,
  { userId, amount, txnReference }: SettleTarget,
  status: "COMPLETED" | "CANCELLED",
): Promise<void> {
  if (txnReference) {
    await tx.transaction.updateMany({
      where: { reference: txnReference, status: "PENDING" },
      data: { status },
    });
    return;
  }

  // ponytail: legacy rows written before txnReference existed. Closes the most
  // recent matching row rather than all of them — still a guess, but a
  // single-row one. Drop this branch once no PENDING withdrawal predates the
  // payout-agents migration.
  const legacy = await tx.transaction.findFirst({
    where: { userId, type: "WITHDRAWAL", status: "PENDING", amount },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (legacy) {
    await tx.transaction.update({ where: { id: legacy.id }, data: { status } });
  }
}

/**
 * Payment proof — the screenshot the player sees as evidence the money was
 * actually sent.
 *
 * Shared by the admin and the payout-agent upload routes so the size limit, the
 * lifetime and the object key can't drift apart between them. The key is the
 * request id, so re-uploading replaces the previous image rather than orphaning
 * it in the bucket.
 */
export const PROOF_TTL_MS = 2 * 24 * 60 * 60 * 1000; // 2 days, then the cron deletes it
const PROOF_MAX_BYTES = 5 * 1024 * 1024;

export type ProofResult = { ok: true } | { ok: false; error: string; status: number };

export async function saveWithdrawalProof(id: string, file: unknown): Promise<ProofResult> {
  if (!storageConfigured()) {
    return { ok: false, error: "Storage not configured", status: 500 };
  }
  if (!(file instanceof File)) {
    return { ok: false, error: "No file", status: 400 };
  }
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "Must be an image", status: 400 };
  }
  if (file.size > PROOF_MAX_BYTES) {
    return { ok: false, error: "Image must be under 5 MB", status: 400 };
  }

  const key = `withdrawals/${id}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  await prisma.withdrawalRequest.update({
    where: { id },
    data: { proofKey: key, proofExpiresAt: new Date(Date.now() + PROOF_TTL_MS) },
  });
  return { ok: true };
}
