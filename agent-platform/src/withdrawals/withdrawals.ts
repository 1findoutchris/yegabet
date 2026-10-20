import { Prisma, PrismaClient, type Withdrawal } from "@prisma/client";
import { audit } from "../auth/audit";
import { actorOf } from "../auth/auth.service";
import { can, type Principal } from "../auth/rbac";
import { decryptField, encryptField, keyedHash } from "../common/fieldCrypto";
import { configAt } from "../config/configVersions";
import { isEnabled } from "../config/featureFlags";
import { METHODS, normalizeReference, maskReference, type Method } from "../deposits/deposits";
import { formatEtb, parseEtb } from "../deposits/money";
import { InsufficientFundsError } from "../ledger/errors";
import type { Ledger } from "../ledger/ledger";
import { maskPhone } from "../users/phone";

/**
 * Withdrawals (plan 06, CLAUDE.md §5.8). Every step that moves money is one
 * ledger posting in the same DB transaction as the status change, with the
 * withdrawal row locked:
 *   request  PLAYER_WALLET → PLAYER_HELD          key withdrawal:<id>:hold
 *   complete PLAYER_HELD   → AGENT_CASH_POSITION  key withdrawal:<id>:final
 *   cancel / decline   PLAYER_HELD → PLAYER_WALLET  key withdrawal:<id>:release
 * "Paid" itself moves nothing in the ledger: the money moved in Telebirr.
 * Q-06b: completion may push the agent's cash position above zero (the
 * platform then owes the agent until settlement).
 */

export const WITHDRAWALS_FLAG = "withdrawals.open";

export type WithdrawalErrorCode =
  | "CLOSED"
  | "NOT_CONFIGURED"
  | "INVALID_INPUT"
  | "PLAYER_NOT_ALLOWED"
  | "AGENT_NOT_ACTIVE"
  | "AMOUNT_OUT_OF_RANGE"
  | "INSUFFICIENT_FUNDS"
  | "DUPLICATE_REFERENCE"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "WRONG_STATE";

export class WithdrawalError extends Error {
  constructor(
    readonly code: WithdrawalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WithdrawalError";
  }
}

type Tx = Prisma.TransactionClient;
type Close = "completed" | "cancelled" | "declined";
const isMethod = (m: unknown): m is Method => METHODS.includes(m as Method);

export class Withdrawals {
  constructor(
    private readonly db: PrismaClient,
    private readonly ledger: Ledger,
    private readonly keys: { hashKey: string; encKey: string },
  ) {}

  // ── Player ────────────────────────────────────────────────────────────────

  async request(playerId: bigint, input: { amount?: unknown; method?: unknown }, ip?: string) {
    if (!(await isEnabled(this.db, WITHDRAWALS_FLAG)))
      throw new WithdrawalError("CLOSED", "withdrawals open soon");
    const now = new Date();
    const limits = (await configAt(this.db, "withdrawals.limits", now))?.value as
      { minSantim: number; maxSantim: number } | undefined;
    const sla = (await configAt(this.db, "withdrawals.sla_hours", now))?.value;
    if (!limits || typeof sla !== "number")
      throw new WithdrawalError("NOT_CONFIGURED", "withdrawals are not configured");

    const amount = parseEtb(input.amount);
    if (amount === null || !isMethod(input.method)) {
      throw new WithdrawalError(
        "INVALID_INPUT",
        "enter the amount in birr and choose telebirr, cbe_birr or ebirr",
      );
    }
    if (amount < BigInt(limits.minSantim) || amount > BigInt(limits.maxSantim)) {
      throw new WithdrawalError(
        "AMOUNT_OUT_OF_RANGE",
        `withdrawals must be between ${limits.minSantim / 100} and ${limits.maxSantim / 100} ETB`,
      );
    }
    const player = await this.db.player.findUnique({
      where: { id: playerId },
      select: { status: true, agentId: true, agent: { select: { status: true } } },
    });
    if (!player || player.status !== "active") {
      throw new WithdrawalError("PLAYER_NOT_ALLOWED", "this account can't withdraw");
    }
    if (player.agent.status !== "active") {
      throw new WithdrawalError(
        "AGENT_NOT_ACTIVE",
        "your agent isn't paying out right now; please contact support",
      );
    }
    const method = input.method;

    try {
      const w = await this.db.$transaction(
        async (tx) => {
          // The id is taken first so the hold's idempotency key can name it.
          const [{ id }] = (await tx.$queryRaw<{ id: bigint }[]>`
            SELECT nextval(pg_get_serial_sequence('withdrawals', 'id')) AS id`) as [{ id: bigint }];
          const wallet = await this.account(tx, "PLAYER_WALLET", playerId);
          const held = await this.account(tx, "PLAYER_HELD", playerId);
          const hold = await this.ledger.postInTransaction(tx, {
            idempotencyKey: `withdrawal:${id}:hold`,
            reason: "withdrawal_hold",
            referenceId: `withdrawal:${id}`,
            entries: [{ debitAccountId: wallet, creditAccountId: held, amount }],
          });
          return tx.withdrawal.create({
            data: {
              id,
              playerId,
              agentId: player.agentId,
              method,
              amount,
              holdTransactionId: hold.transaction.id,
              slaDueAt: new Date(now.getTime() + sla * 3_600_000),
            },
          });
        },
        { timeout: 15_000, maxWait: 15_000 },
      );
      await audit(this.db, {
        actorKind: "player",
        actorId: playerId.toString(),
        action: "withdrawal.requested",
        target: `withdrawal:${w.id}`,
        after: { amount: amount.toString(), method, agentId: player.agentId.toString() },
        ip,
      });
      return w;
    } catch (e) {
      if (e instanceof InsufficientFundsError) {
        throw new WithdrawalError("INSUFFICIENT_FUNDS", "you don't have that much available to withdraw");
      }
      throw e;
    }
  }

  async listForPlayer(playerId: bigint) {
    const player = await this.db.player.findUnique({ where: { id: playerId }, select: { phoneEnc: true } });
    const destination = player ? maskPhone(decryptField(player.phoneEnc, this.keys.encKey)) : null;
    const rows = await this.db.withdrawal.findMany({
      where: { playerId },
      orderBy: { id: "desc" },
      take: 100,
    });
    return rows.map((w) => ({ ...this.view(w, true), destination }));
  }

  cancel(principal: Principal, id: bigint, ip?: string) {
    return this.step(
      principal,
      id,
      "player",
      ["requested"],
      async (tx, w) => this.close(tx, w, "cancelled", principal, "cancelled by player"),
      ip,
    );
  }

  received(principal: Principal, id: bigint, ip?: string) {
    return this.step(
      principal,
      id,
      "player",
      ["paid"],
      async (tx, w) => this.close(tx, w, "completed", principal, "player confirmed receipt"),
      ip,
    );
  }

  notReceived(principal: Principal, id: bigint, ip?: string) {
    return this.step(
      principal,
      id,
      "player",
      ["paid"],
      (tx, w) => tx.withdrawal.update({ where: { id: w.id }, data: { status: "disputed" } }),
      ip,
    );
  }

  // ── Agent / staff ─────────────────────────────────────────────────────────

  async queue(principal: Principal, status: unknown) {
    const where: Prisma.WithdrawalWhereInput = {
      status: typeof status === "string" && status ? status : "requested",
    };
    if (!can(principal, "withdrawals.override")) {
      if (principal.kind !== "agent_member" || !can(principal, "withdrawals.review.own")) {
        throw new WithdrawalError("FORBIDDEN", "only the agent's own members can see this queue");
      }
      where.agentId = principal.agentId;
    }
    const rows = await this.db.withdrawal.findMany({ where, orderBy: { id: "asc" }, take: 200 });
    const phones = new Map(
      (
        await this.db.player.findMany({
          where: { id: { in: rows.map((r) => r.playerId) } },
          select: { id: true, phoneEnc: true },
        })
      ).map((p) => [p.id, decryptField(p.phoneEnc, this.keys.encKey)]),
    );
    // The paying agent needs the full number to send the money to (Q-31).
    // Every withdrawal has its player (foreign key), so the lookup always hits.
    return rows.map((w) => ({ ...this.view(w, false), payTo: phones.get(w.playerId) as string }));
  }

  /** The agent paid outside (Telebirr…) and records the reference. Same reference again = same result. */
  async markPaid(principal: Principal, id: bigint, reference: unknown, ip?: string) {
    const ref = (() => {
      try {
        return normalizeReference(reference);
      } catch {
        throw new WithdrawalError("INVALID_INPUT", "enter the reference of your payment to the player");
      }
    })();
    try {
      return await this.step(
        principal,
        id,
        "agent",
        ["requested", "escalated", "paid"],
        async (tx, w) => {
          const hash = keyedHash(ref, this.keys.hashKey, `withdrawal-ref:${w.method}`);
          if (w.status === "paid") {
            if (w.paidReferenceHash === hash) return w;
            throw new WithdrawalError(
              "WRONG_STATE",
              "this withdrawal is already marked paid with another reference",
            );
          }
          const actor = actorOf(principal);
          return tx.withdrawal.update({
            where: { id: w.id },
            data: {
              status: "paid",
              paidReferenceHash: hash,
              paidReferenceEnc: encryptField(ref, this.keys.encKey),
              paidAt: new Date(),
              paidByKind: actor.actorKind,
              paidById: actor.actorId,
            },
          });
        },
        ip,
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new WithdrawalError(
          "DUPLICATE_REFERENCE",
          "this payment reference was already used for another withdrawal",
        );
      }
      throw e;
    }
  }

  async decline(principal: Principal, id: bigint, reason: unknown, ip?: string) {
    const why = this.reason(reason);
    return this.step(
      principal,
      id,
      "agent",
      ["requested"],
      (tx, w) => this.close(tx, w, "declined", principal, why),
      ip,
    );
  }

  /** Owner: finish an escalated, disputed or paid withdrawal as paid out. */
  complete(principal: Principal, id: bigint, ip?: string) {
    return this.step(
      principal,
      id,
      "staff",
      ["paid", "escalated", "disputed"],
      (tx, w) => this.close(tx, w, "completed", principal, "completed by staff"),
      ip,
    );
  }

  /** Owner: give the money back to the player's wallet. */
  async staffCancel(principal: Principal, id: bigint, reason: unknown, ip?: string) {
    const why = this.reason(reason);
    return this.step(
      principal,
      id,
      "staff",
      ["requested", "escalated", "disputed"],
      (tx, w) => this.close(tx, w, "cancelled", principal, why),
      ip,
    );
  }

  // ── SLA job ───────────────────────────────────────────────────────────────

  /** Unpaid past the SLA → escalated; paid but unanswered past the auto-complete window → completed. */
  async runSla(now = new Date()): Promise<{ escalated: number; completed: number }> {
    const { count: escalated } = await this.db.withdrawal.updateMany({
      where: { status: "requested", slaDueAt: { lt: now } },
      data: { status: "escalated" },
    });
    const hours = (await configAt(this.db, "withdrawals.auto_complete_hours", now))?.value;
    let completed = 0;
    if (typeof hours === "number" && hours > 0) {
      const due = await this.db.withdrawal.findMany({
        where: { status: "paid", paidAt: { lt: new Date(now.getTime() - hours * 3_600_000) } },
        select: { id: true },
        take: 500,
      });
      for (const { id } of due) {
        await this.db.$transaction(async (tx) => {
          const w = await this.lock(tx, id);
          if (w.status === "paid") {
            await this.close(tx, w, "completed", null, "auto-completed: no answer from the player");
            completed += 1;
          }
        });
      }
    }
    if (escalated + completed > 0) {
      await audit(this.db, {
        actorKind: "system",
        action: "withdrawal.sla",
        after: { escalated, completed },
      });
    }
    return { escalated, completed };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private reason(reason: unknown): string {
    const why = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
    if (!why) throw new WithdrawalError("INVALID_INPUT", "give a reason");
    return why;
  }

  private async account(
    tx: Tx,
    type: "PLAYER_WALLET" | "PLAYER_HELD" | "AGENT_CASH_POSITION",
    ownerId: bigint,
  ) {
    const ownerKind = type === "AGENT_CASH_POSITION" ? "agent" : "player";
    return (await this.ledger.openAccount({ type, ownerKind, ownerId: ownerId.toString() }, tx)).id;
  }

  private async lock(tx: Tx, id: bigint): Promise<Withdrawal> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`SELECT id FROM withdrawals WHERE id = ${id} FOR UPDATE`;
    const w = rows.length ? await tx.withdrawal.findUnique({ where: { id } }) : null;
    if (!w) throw new WithdrawalError("NOT_FOUND", "no such withdrawal");
    return w;
  }

  /**
   * One step: lock the row, check who may act and in which states, run the
   * change, audit it, all in one transaction.
   *   player → only their own; agent → own agent's members (or the owner); staff → owner.
   */
  private async step(
    principal: Principal,
    id: bigint,
    who: "player" | "agent" | "staff",
    from: string[],
    change: (tx: Tx, w: Withdrawal) => Promise<Withdrawal>,
    ip?: string,
  ): Promise<Withdrawal> {
    const override = can(principal, "withdrawals.override");
    const allowed =
      who === "player"
        ? principal.kind === "player"
        : who === "agent"
          ? override || (principal.kind === "agent_member" && can(principal, "withdrawals.review.own"))
          : override;
    if (!allowed) throw new WithdrawalError("FORBIDDEN", "you can't do this");

    return this.db.$transaction(
      async (tx) => {
        const w = await this.lock(tx, id);
        const mine =
          principal.kind === "player"
            ? w.playerId === principal.playerId
            : principal.kind === "agent_member"
              ? w.agentId === principal.agentId
              : true;
        if (!mine) throw new WithdrawalError("NOT_FOUND", "no such withdrawal");
        if (!from.includes(w.status)) {
          throw new WithdrawalError("WRONG_STATE", `this withdrawal is ${w.status}`);
        }
        const before = w.status;
        const updated = await change(tx, w);
        if (updated.status !== before) {
          await audit(tx, {
            ...actorOf(principal),
            action: `withdrawal.${updated.status}${override && principal.kind === "staff" ? ".override" : ""}`,
            target: `withdrawal:${w.id}`,
            before: { status: before },
            after: { status: updated.status, amount: w.amount.toString() },
            ip,
          });
        }
        return updated;
      },
      { timeout: 15_000, maxWait: 15_000 },
    );
  }

  /** The closing posting plus the status change. `principal` null = the system (SLA job). */
  private async close(tx: Tx, w: Withdrawal, to: Close, principal: Principal | null, reason: string) {
    const held = await this.account(tx, "PLAYER_HELD", w.playerId);
    const completing = to === "completed";
    const target = completing
      ? await this.account(tx, "AGENT_CASH_POSITION", w.agentId)
      : await this.account(tx, "PLAYER_WALLET", w.playerId);
    const posted = await this.ledger.postInTransaction(tx, {
      idempotencyKey: `withdrawal:${w.id}:${completing ? "final" : "release"}`,
      reason: completing ? "withdrawal_paid" : "withdrawal_released",
      referenceId: `withdrawal:${w.id}`,
      entries: [{ debitAccountId: held, creditAccountId: target, amount: w.amount }],
    });
    const actor = principal ? actorOf(principal) : { actorKind: "system", actorId: "sla" };
    return tx.withdrawal.update({
      where: { id: w.id },
      data: {
        status: to,
        finalTransactionId: posted.transaction.id,
        closedByKind: actor.actorKind,
        closedById: actor.actorId,
        closeReason: reason,
        closedAt: new Date(),
      },
    });
  }

  private view(w: Withdrawal, forPlayer: boolean) {
    const ref = w.paidReferenceEnc ? decryptField(w.paidReferenceEnc, this.keys.encKey) : null;
    return {
      id: w.id.toString(),
      playerId: w.playerId.toString(),
      agentId: w.agentId.toString(),
      method: w.method,
      amountSantim: w.amount.toString(),
      amountEtb: formatEtb(w.amount),
      status: w.status,
      paidReference: ref && forPlayer ? maskReference(ref) : ref,
      slaDueAt: w.slaDueAt.toISOString(),
      createdAt: w.createdAt.toISOString(),
      closedAt: w.closedAt?.toISOString() ?? null,
      closeReason: w.closeReason,
    };
  }
}
