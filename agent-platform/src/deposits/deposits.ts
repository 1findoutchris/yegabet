import { Prisma, PrismaClient, type Deposit } from "@prisma/client";
import { audit } from "../auth/audit";
import { actorOf } from "../auth/auth.service";
import { can, type Principal } from "../auth/rbac";
import { decryptField, encryptField, keyedHash } from "../common/fieldCrypto";
import { configAt } from "../config/configVersions";
import { isEnabled } from "../config/featureFlags";
import type { Ledger } from "../ledger/ledger";
import { formatEtb, parseEtb } from "./money";

/**
 * Deposits with manual confirmation (plan 05, CLAUDE.md §5.7).
 *
 * Money moves only on confirm, as one posting
 *   AGENT_CASH_POSITION(agent) → PLAYER_WALLET(player), key "deposit:<id>",
 * made in the same DB transaction as the status change, with the deposit row
 * locked, so confirm and reject can't both win.
 */

export const DEPOSITS_FLAG = "deposits.open";
export const METHODS = ["telebirr", "cbe_birr", "ebirr"] as const;
export type Method = (typeof METHODS)[number];

export type DepositErrorCode =
  | "CLOSED"
  | "NOT_CONFIGURED"
  | "INVALID_INPUT"
  | "PLAYER_NOT_ALLOWED"
  | "AGENT_NOT_ACTIVE"
  | "ACCOUNT_NOT_AVAILABLE"
  | "ACCOUNT_TAKEN"
  | "AMOUNT_OUT_OF_RANGE"
  | "DUPLICATE_REFERENCE"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "ALREADY_DECIDED";

export class DepositError extends Error {
  constructor(
    readonly code: DepositErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DepositError";
  }
}

export interface DepositKeys {
  hashKey: string;
  encKey: string;
}

/** Upper case, no spaces or dashes: "chk 123-45" and "CHK12345" are one reference. */
export function normalizeReference(input: unknown): string {
  const ref = typeof input === "string" ? input.toUpperCase().replace(/[\s-]/g, "") : "";
  if (!/^[A-Z0-9]{4,64}$/.test(ref)) {
    throw new DepositError("INVALID_INPUT", "enter the transaction reference from your payment SMS");
  }
  return ref;
}

export const maskReference = (ref: string): string => `****${ref.slice(-4)}`;

const isMethod = (m: unknown): m is Method => METHODS.includes(m as Method);
const DECISIONS = { confirm: "confirmed", reject: "rejected" } as const;

export class Deposits {
  constructor(
    private readonly db: PrismaClient,
    private readonly ledger: Ledger,
    private readonly keys: DepositKeys,
  ) {}

  // ── Payment accounts (agents manage their own, Q-29) ──────────────────────

  private agentOf(
    principal: Principal,
    permission: "payment_accounts.manage.own" | "deposits.review.own",
  ): bigint {
    if (principal.kind !== "agent_member" || !can(principal, permission)) {
      throw new DepositError("FORBIDDEN", "only the agent's own members can do this");
    }
    return principal.agentId;
  }

  async addPaymentAccount(
    principal: Principal,
    input: { method?: unknown; accountName?: unknown; accountNumber?: unknown },
    ip?: string,
  ) {
    const agentId = this.agentOf(principal, "payment_accounts.manage.own");
    const accountName = typeof input.accountName === "string" ? input.accountName.trim() : "";
    const accountNumber =
      typeof input.accountNumber === "string" ? input.accountNumber.replace(/[\s-]/g, "") : "";
    if (
      !isMethod(input.method) ||
      accountName.length < 2 ||
      accountName.length > 80 ||
      !/^\+?\d{6,20}$/.test(accountNumber)
    ) {
      throw new DepositError(
        "INVALID_INPUT",
        "choose telebirr, cbe_birr or ebirr, and enter the account name and number",
      );
    }
    try {
      const account = await this.db.agentPaymentAccount.create({
        data: { agentId, method: input.method, accountName, accountNumber },
      });
      await audit(this.db, {
        ...actorOf(principal),
        action: "payment_account.added",
        target: `payment_account:${account.id}`,
        after: { agentId: agentId.toString(), method: account.method, accountNumber: account.accountNumber },
        ip,
      });
      return account;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new DepositError("ACCOUNT_TAKEN", "this account number is already registered");
      }
      throw e;
    }
  }

  async deactivatePaymentAccount(principal: Principal, accountId: bigint, ip?: string) {
    const agentId = this.agentOf(principal, "payment_accounts.manage.own");
    const { count } = await this.db.agentPaymentAccount.updateMany({
      where: { id: accountId, agentId, active: true },
      data: { active: false },
    });
    if (count === 0) throw new DepositError("NOT_FOUND", "no such active payment account");
    await audit(this.db, {
      ...actorOf(principal),
      action: "payment_account.deactivated",
      target: `payment_account:${accountId}`,
      ip,
    });
  }

  listOwnPaymentAccounts(principal: Principal) {
    const agentId = this.agentOf(principal, "payment_accounts.manage.own");
    return this.db.agentPaymentAccount.findMany({ where: { agentId }, orderBy: { id: "asc" } });
  }

  // ── Player side ───────────────────────────────────────────────────────────

  private async playerAndAgent(playerId: bigint) {
    const player = await this.db.player.findUnique({
      where: { id: playerId },
      select: { status: true, agentId: true, agent: { select: { status: true } } },
    });
    if (!player || player.status !== "active") {
      throw new DepositError("PLAYER_NOT_ALLOWED", "this account can't make deposits");
    }
    if (player.agent.status !== "active") {
      throw new DepositError("AGENT_NOT_ACTIVE", "your agent isn't taking deposits right now");
    }
    return player;
  }

  /** The player's current agent's active numbers to pay into. */
  async accountsForPlayer(playerId: bigint) {
    const { agentId } = await this.playerAndAgent(playerId);
    return this.db.agentPaymentAccount.findMany({
      where: { agentId, active: true },
      select: { id: true, method: true, accountName: true, accountNumber: true },
      orderBy: { id: "asc" },
    });
  }

  async submit(
    playerId: bigint,
    input: { paymentAccountId?: unknown; amount?: unknown; reference?: unknown },
    ip?: string,
  ): Promise<Deposit> {
    if (!(await isEnabled(this.db, DEPOSITS_FLAG))) throw new DepositError("CLOSED", "deposits open soon");
    const limits = (await configAt(this.db, "deposits.limits", new Date()))?.value as
      { minSantim: number; maxSantim: number } | undefined;
    if (!limits) throw new DepositError("NOT_CONFIGURED", "deposit limits are not configured");

    const amount = parseEtb(input.amount);
    if (amount === null)
      throw new DepositError("INVALID_INPUT", "enter the amount in birr, e.g. 500 or 500.50");
    if (amount < BigInt(limits.minSantim) || amount > BigInt(limits.maxSantim)) {
      throw new DepositError(
        "AMOUNT_OUT_OF_RANGE",
        `deposits must be between ${limits.minSantim / 100} and ${limits.maxSantim / 100} ETB`,
      );
    }
    const reference = normalizeReference(input.reference);
    const accountId =
      typeof input.paymentAccountId === "string" && /^\d{1,18}$/.test(input.paymentAccountId)
        ? BigInt(input.paymentAccountId)
        : null;

    const player = await this.playerAndAgent(playerId);
    const account = accountId
      ? await this.db.agentPaymentAccount.findUnique({ where: { id: accountId } })
      : null;
    if (!account || !account.active || account.agentId !== player.agentId) {
      throw new DepositError("ACCOUNT_NOT_AVAILABLE", "choose one of your agent's payment accounts");
    }

    try {
      const deposit = await this.db.deposit.create({
        data: {
          playerId,
          agentId: player.agentId,
          paymentAccountId: account.id,
          method: account.method,
          amount,
          referenceHash: keyedHash(reference, this.keys.hashKey, `deposit-ref:${account.method}`),
          referenceEnc: encryptField(reference, this.keys.encKey),
        },
      });
      await audit(this.db, {
        actorKind: "player",
        actorId: playerId.toString(),
        action: "deposit.submitted",
        target: `deposit:${deposit.id}`,
        after: { amount: amount.toString(), method: account.method, agentId: player.agentId.toString() },
        ip,
      });
      return deposit;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new DepositError("DUPLICATE_REFERENCE", "this transaction reference was already used");
      }
      throw e;
    }
  }

  async listForPlayer(playerId: bigint) {
    const rows = await this.db.deposit.findMany({ where: { playerId }, orderBy: { id: "desc" }, take: 100 });
    return rows.map((d) => this.view(d, true));
  }

  // ── Agent / staff side ────────────────────────────────────────────────────

  /** Agent members see their own agent's queue; staff who may override see all. */
  async queue(principal: Principal, status: unknown) {
    const where: Prisma.DepositWhereInput = {
      status: typeof status === "string" && status ? status : "pending",
    };
    if (!can(principal, "deposits.override")) where.agentId = this.agentOf(principal, "deposits.review.own");
    const rows = await this.db.deposit.findMany({ where, orderBy: { id: "asc" }, take: 200 });
    return rows.map((d) => this.view(d, false));
  }

  /**
   * Confirm or reject. Repeating the same decision returns the same result
   * (double tap, retry); a different decision on a decided deposit is refused.
   */
  async decide(
    principal: Principal,
    depositId: bigint,
    decision: "confirm" | "reject",
    reason: unknown,
    ip?: string,
  ): Promise<Deposit> {
    const isOverride = can(principal, "deposits.override");
    const ownAgent = isOverride ? null : this.agentOf(principal, "deposits.review.own");
    const why = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
    if (decision === "reject" && !why) throw new DepositError("INVALID_INPUT", "give a reason for rejecting");
    const target = DECISIONS[decision];

    return this.db.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<
          { id: bigint }[]
        >`SELECT id FROM deposits WHERE id = ${depositId} FOR UPDATE`;
        const deposit = locked ? await tx.deposit.findUnique({ where: { id: depositId } }) : null;
        if (!deposit || (ownAgent !== null && deposit.agentId !== ownAgent)) {
          throw new DepositError("NOT_FOUND", "no such deposit in your queue");
        }
        if (deposit.status === target) return deposit;
        if (deposit.status !== "pending") {
          throw new DepositError("ALREADY_DECIDED", `this deposit is already ${deposit.status}`);
        }

        let ledgerTransactionId: bigint | null = null;
        if (decision === "confirm") {
          // One after the other: a transaction runs one query at a time.
          const cash = await this.ledger.openAccount(
            { type: "AGENT_CASH_POSITION", ownerKind: "agent", ownerId: deposit.agentId.toString() },
            tx,
          );
          const wallet = await this.ledger.openAccount(
            { type: "PLAYER_WALLET", ownerKind: "player", ownerId: deposit.playerId.toString() },
            tx,
          );
          const posted = await this.ledger.postInTransaction(tx, {
            idempotencyKey: `deposit:${deposit.id}`,
            reason: "deposit",
            referenceId: `deposit:${deposit.id}`,
            entries: [{ debitAccountId: cash.id, creditAccountId: wallet.id, amount: deposit.amount }],
          });
          ledgerTransactionId = posted.transaction.id;
        }

        const actor = actorOf(principal);
        const updated = await tx.deposit.update({
          where: { id: deposit.id },
          data: {
            status: target,
            decidedByKind: actor.actorKind,
            decidedById: actor.actorId,
            decisionReason: why || null,
            decidedAt: new Date(),
            ledgerTransactionId,
          },
        });
        await audit(tx, {
          ...actor,
          action: isOverride ? `deposit.${target}.override` : `deposit.${target}`,
          target: `deposit:${deposit.id}`,
          before: { status: "pending" },
          after: { status: target, amount: deposit.amount.toString(), reason: why || null },
          ip,
        });
        return updated;
      },
      { timeout: 15_000, maxWait: 15_000 },
    );
  }

  /** Pending deposits older than the configured TTL become "expired" (Q-30: 24 h). Returns how many. */
  async expireStale(now = new Date()): Promise<number> {
    const ttl = (await configAt(this.db, "deposits.pending_ttl_hours", now))?.value;
    if (typeof ttl !== "number" || ttl <= 0) return 0;
    const cutoff = new Date(now.getTime() - ttl * 3_600_000);
    const { count } = await this.db.deposit.updateMany({
      where: { status: "pending", createdAt: { lt: cutoff } },
      data: {
        status: "expired",
        decidedByKind: "system",
        decidedAt: now,
        decisionReason: "not confirmed in time",
      },
    });
    if (count > 0) {
      await audit(this.db, {
        actorKind: "system",
        action: "deposit.expired",
        after: { count, cutoff: cutoff.toISOString() },
      });
    }
    return count;
  }

  /** JSON view: amounts as strings; the reference masked for players, full for the agent who must match it. */
  private view(d: Deposit, maskRef: boolean) {
    const ref = decryptField(d.referenceEnc, this.keys.encKey);
    return {
      id: d.id.toString(),
      playerId: d.playerId.toString(),
      agentId: d.agentId.toString(),
      paymentAccountId: d.paymentAccountId.toString(),
      method: d.method,
      amountSantim: d.amount.toString(),
      amountEtb: formatEtb(d.amount),
      reference: maskRef ? maskReference(ref) : ref,
      status: d.status,
      decisionReason: d.decisionReason,
      createdAt: d.createdAt.toISOString(),
      decidedAt: d.decidedAt?.toISOString() ?? null,
    };
  }
}
