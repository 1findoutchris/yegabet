import { Prisma, PrismaClient, type SettlementPeriod } from "@prisma/client";
import { audit } from "../auth/audit";
import { actorOf } from "../auth/auth.service";
import type { Principal } from "../auth/rbac";
import type { Ledger } from "../ledger/ledger";
import { RulesError, rulesAt, split, type Rules } from "./rules";

/**
 * Settlement (plan 10, CLAUDE.md §5.10). For each agent × provider and each
 * 10-day period: G = Σ stake − Σ win of bets settled by the period's end
 * (minus payment fees, 0 for now). G > 0 is split by the dated rules; G ≤ 0 is
 * the agent's alone (owner, Q-02). Only approval moves money: the non-agent
 * shares leave the agent's cash position (game money already sits there, Q-34).
 *
 * Counting is by difference: each bet contributes (what it is worth now) −
 * (what approved periods already counted). A bet never counts twice, and a
 * rollback or late win after approval becomes an adjustment in the next period.
 */

type Tx = Prisma.TransactionClient;
export type SettlementErrorCode =
  "NOT_FOUND" | "NOT_ENDED" | "OUT_OF_ORDER" | "WRONG_STATE" | "STALE_DRAFT" | "RULES";

export class SettlementError extends Error {
  constructor(
    readonly code: SettlementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SettlementError";
  }
}

interface Group {
  agentId: bigint;
  providerId: string;
  stakes: bigint;
  winnings: bigint;
}

interface LineDraft {
  agentId: bigint;
  providerId: string;
  stakes: bigint;
  winnings: bigint;
  fees: bigint;
  result: bigint;
  beneficiary: "agent" | "company" | "provider" | "parent";
  beneficiaryAgentId: bigint | null;
  parentLevel: number | null;
  amount: bigint;
}

const DAY_MS = 86_400_000;
const TX = { timeout: 120_000, maxWait: 10_000 };

export class Settlement {
  constructor(
    private readonly db: PrismaClient,
    private readonly ledger: Ledger,
  ) {}

  /** Create every period that has started by `now` (rules at `now`). Returns how many were added. */
  async ensurePeriods(now: Date): Promise<number> {
    const rules = await this.rules(now);
    const last = await this.db.settlementPeriod.findFirst({ orderBy: { startsAt: "desc" } });
    let start = last ? last.endsAt : rules.firstPeriodStart;
    let added = 0;
    while (start.getTime() <= now.getTime()) {
      const endsAt = new Date(start.getTime() + rules.periodDays * DAY_MS);
      await this.db.settlementPeriod.create({ data: { startsAt: start, endsAt } });
      added += 1;
      start = endsAt;
    }
    return added;
  }

  /** ensurePeriods, but quietly does nothing until the launch date is configured. */
  async ensurePeriodsIfConfigured(now = new Date()): Promise<number> {
    try {
      return await this.ensurePeriods(now);
    } catch (e) {
      if (e instanceof SettlementError && e.code === "RULES") return 0;
      throw e;
    }
  }

  list() {
    return this.db.settlementPeriod.findMany({ orderBy: { startsAt: "asc" } });
  }

  /** Compute (or recompute) a period's draft. Only for an ended period whose predecessors are all approved. */
  async draft(periodId: bigint, principal: Principal | null, now = new Date()): Promise<SettlementPeriod> {
    return this.db.$transaction(async (tx) => {
      const period = await this.lockPeriod(tx, periodId);
      if (period.status === "approved")
        throw new SettlementError("WRONG_STATE", "this period is already approved");
      if (period.endsAt.getTime() > now.getTime())
        throw new SettlementError("NOT_ENDED", "this period hasn't ended yet");
      await this.requireEarlierApproved(tx, period);
      const rules = await this.rules(period.endsAt);
      const lines = await this.compute(tx, period, rules);
      await tx.settlementLine.deleteMany({ where: { periodId } });
      if (lines.length > 0)
        await tx.settlementLine.createMany({ data: lines.map((l) => ({ ...l, periodId })) });
      const updated = await tx.settlementPeriod.update({
        where: { id: periodId },
        data: { status: "draft", draftedAt: now, config: rules.versions },
      });
      await audit(tx, {
        ...(principal ? actorOf(principal) : { actorKind: "system", actorId: "settlement" }),
        action: "settlement.drafted",
        target: `settlement_period:${periodId}`,
        after: { lines: lines.length },
      });
      return updated;
    }, TX);
  }

  /**
   * Approve: recompute, refuse if anything changed since the draft (STALE_DRAFT:
   * redraft and review again), post the shares, record what was counted, freeze.
   */
  async approve(periodId: bigint, principal: Principal): Promise<SettlementPeriod> {
    return this.db.$transaction(async (tx) => {
      const period = await this.lockPeriod(tx, periodId);
      if (period.status === "approved") return period;
      if (period.status !== "draft") throw new SettlementError("WRONG_STATE", "draft this period first");
      await this.requireEarlierApproved(tx, period);
      const rules = await this.rules(period.endsAt);
      const fresh = await this.compute(tx, period, rules);
      const stored = await tx.settlementLine.findMany({ where: { periodId }, orderBy: { id: "asc" } });
      const key = (l: Omit<LineDraft, never>) =>
        [
          l.agentId,
          l.providerId,
          l.beneficiary,
          l.beneficiaryAgentId,
          l.parentLevel,
          l.amount,
          l.result,
        ].join("|");
      if (
        fresh.map(key).sort().join() !==
        stored
          .map((l) => key(l as unknown as LineDraft))
          .sort()
          .join()
      ) {
        throw new SettlementError(
          "STALE_DRAFT",
          "bets changed since this draft; redraft and review it again",
        );
      }

      const groups = new Map<string, typeof stored>();
      for (const l of stored) {
        const k = `${l.agentId}|${l.providerId}`;
        groups.set(k, [...(groups.get(k) ?? []), l]);
      }
      for (const [k, lines] of groups) {
        const [agentId, providerId] = k.split("|") as [string, string];
        const out = lines.filter((l) => l.beneficiary !== "agent" && l.amount > 0n);
        if (out.length === 0) continue;
        const cash = await this.account(tx, "AGENT_CASH_POSITION", "agent", agentId);
        const legs = [];
        for (const l of out) {
          const to =
            l.beneficiary === "company"
              ? await this.account(tx, "COMPANY_REVENUE", "company", "company")
              : l.beneficiary === "provider"
                ? await this.account(tx, "PROVIDER_FEES", "provider", providerId)
                : await this.account(tx, "PARENT_PAYABLE", "agent", String(l.beneficiaryAgentId));
          legs.push({ debitAccountId: cash, creditAccountId: to, amount: l.amount });
        }
        const posted = await this.ledger.postInTransaction(tx, {
          idempotencyKey: `settlement:${periodId}:${agentId}:${providerId}`,
          reason: "settlement",
          referenceId: `settlement_period:${periodId}`,
          entries: legs,
        });
        await tx.settlementLine.updateMany({
          where: { id: { in: lines.map((l) => l.id) } },
          data: { ledgerTransactionId: posted.transaction.id },
        });
      }

      // What each bet is now counted as (a rolled-back bet counts 0).
      for (const b of await this.contributingBets(tx, period)) {
        await tx.settlementCounted.upsert({
          where: { betId: b.id },
          create: { betId: b.id, stake: b.stakeNow, win: b.winNow, periodId },
          update: { stake: b.stakeNow, win: b.winNow, periodId },
        });
      }
      const actor = actorOf(principal);
      const approved = await tx.settlementPeriod.update({
        where: { id: periodId },
        data: {
          status: "approved",
          approvedAt: new Date(),
          approvedByKind: actor.actorKind,
          approvedById: actor.actorId,
        },
      });
      await audit(tx, { ...actor, action: "settlement.approved", target: `settlement_period:${periodId}` });
      return approved;
    }, TX);
  }

  /** Per-agent statements for a period, with the cash-netting instruction (current balances). */
  async statements(periodId: bigint, agentId?: bigint) {
    const period = await this.db.settlementPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new SettlementError("NOT_FOUND", "no such period");
    const lines = await this.db.settlementLine.findMany({
      where: { periodId, ...(agentId === undefined ? {} : { agentId }) },
      orderBy: [{ agentId: "asc" }, { id: "asc" }],
    });
    const byAgent = new Map<bigint, typeof lines>();
    for (const l of lines) byAgent.set(l.agentId, [...(byAgent.get(l.agentId) ?? []), l]);
    const out = [];
    for (const [id, ls] of byAgent) {
      out.push({ agentId: id.toString(), lines: ls.map(view), netting: await this.netting(id) });
    }
    return { period: periodView(period), statements: out };
  }

  /** Approved statements of one agent (the agent's own view). */
  async agentStatements(agentId: bigint) {
    const periods = await this.db.settlementPeriod.findMany({
      where: { status: "approved", lines: { some: { agentId } } },
      orderBy: { startsAt: "desc" },
      take: 36,
    });
    const out = [];
    for (const p of periods) out.push(await this.statements(p.id, agentId));
    return { netting: await this.netting(agentId), periods: out };
  }

  /**
   * What the agent and the platform owe each other now: the agent's cash
   * position (negative = the agent holds platform money) plus what the platform
   * owes them as a parent. Negative total → the agent remits it; positive → the company pays.
   */
  async netting(agentId: bigint) {
    const bal = async (type: "AGENT_CASH_POSITION" | "PARENT_PAYABLE") => {
      // Every agent gets these accounts when it is created (Task 03).
      const acc = await this.db.account.findFirstOrThrow({
        where: { type, ownerKind: "agent", ownerId: agentId.toString() },
        select: { balance: { select: { balance: true } } },
      });
      return (acc.balance as { balance: bigint }).balance;
    };
    const cash = await bal("AGENT_CASH_POSITION");
    const parent = await bal("PARENT_PAYABLE");
    const net = cash + parent;
    return {
      cashPositionSantim: cash.toString(),
      parentPayableSantim: parent.toString(),
      netSantim: net.toString(),
      instruction: net < 0n ? "remit_to_company" : net > 0n ? "company_pays_agent" : "settled",
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async rules(at: Date): Promise<Rules> {
    try {
      return await rulesAt(this.db, at);
    } catch (e) {
      if (e instanceof RulesError) throw new SettlementError("RULES", e.message);
      throw e;
    }
  }

  private async lockPeriod(tx: Tx, id: bigint) {
    const rows = await tx.$queryRaw<
      { id: bigint }[]
    >`SELECT id FROM settlement_periods WHERE id = ${id} FOR UPDATE`;
    if (rows.length === 0) throw new SettlementError("NOT_FOUND", "no such period");
    return tx.settlementPeriod.findUniqueOrThrow({ where: { id } });
  }

  private async requireEarlierApproved(tx: Tx, period: SettlementPeriod) {
    const earlier = await tx.settlementPeriod.count({
      where: { startsAt: { lt: period.startsAt }, status: { not: "approved" } },
    });
    if (earlier > 0) throw new SettlementError("OUT_OF_ORDER", "approve the earlier periods first");
  }

  /** Bets whose value differs from what was counted, settled or rolled back by the period's end. */
  private async contributingBets(tx: Tx, period: SettlementPeriod) {
    const rows = await tx.$queryRaw<
      {
        id: bigint;
        agent_id: bigint;
        provider_id: string;
        stake_now: bigint;
        win_now: bigint;
        stake_was: bigint;
        win_was: bigint;
      }[]
    >`
      SELECT b.id, b.agent_id, b.provider_id,
             CASE WHEN b.status = 'rolled_back' THEN 0 ELSE b.stake END::bigint AS stake_now,
             CASE WHEN b.status = 'rolled_back' THEN 0 ELSE b.win END::bigint AS win_now,
             COALESCE(c.stake, 0)::bigint AS stake_was, COALESCE(c.win, 0)::bigint AS win_was
      FROM bets b LEFT JOIN settlement_counted c ON c.bet_id = b.id
      WHERE b.status IN ('settled', 'rolled_back') AND b.settled_at < ${period.endsAt}
        AND (CASE WHEN b.status = 'rolled_back' THEN 0 ELSE b.stake END <> COALESCE(c.stake, 0)
          OR CASE WHEN b.status = 'rolled_back' THEN 0 ELSE b.win END <> COALESCE(c.win, 0))
      ORDER BY b.id`;
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      providerId: r.provider_id,
      stakeNow: r.stake_now,
      winNow: r.win_now,
      stakeDelta: r.stake_now - r.stake_was,
      winDelta: r.win_now - r.win_was,
    }));
  }

  private async compute(tx: Tx, period: SettlementPeriod, rules: Rules): Promise<LineDraft[]> {
    const groups = new Map<string, Group>();
    for (const b of await this.contributingBets(tx, period)) {
      const k = `${b.agentId}|${b.providerId}`;
      const g = groups.get(k) ?? {
        agentId: b.agentId,
        providerId: b.providerId,
        stakes: 0n,
        winnings: 0n,
      };
      g.stakes += b.stakeDelta;
      g.winnings += b.winDelta;
      groups.set(k, g);
    }
    const lines: LineDraft[] = [];
    // Groups come out in bet order (the query sorts by bet id), so the draft is deterministic.
    for (const g of groups.values()) {
      const fees = 0n; // rules.paymentFees.mode === "none" (Q-03b)
      const result = g.stakes - g.winnings - fees;
      const base = {
        agentId: g.agentId,
        providerId: g.providerId,
        stakes: g.stakes,
        winnings: g.winnings,
        fees,
        result,
      };
      if (result <= 0n) {
        // The agent carries it (Q-02): recorded on the statement, nothing moves.
        lines.push({
          ...base,
          beneficiary: "agent",
          beneficiaryAgentId: null,
          parentLevel: null,
          amount: result,
        });
        continue;
      }
      const agent = await tx.agent.findUniqueOrThrow({
        where: { id: g.agentId },
        select: { ancestors: true },
      });
      for (const s of split(result, rules, agent.ancestors)) lines.push({ ...base, ...s });
    }
    return lines;
  }

  private async account(tx: Tx, type: string, ownerKind: string, ownerId: string) {
    return (
      await this.ledger.openAccount({ type: type as never, ownerKind: ownerKind as never, ownerId }, tx)
    ).id;
  }
}

function view(l: {
  providerId: string;
  stakes: bigint;
  winnings: bigint;
  fees: bigint;
  result: bigint;
  beneficiary: string;
  beneficiaryAgentId: bigint | null;
  parentLevel: number | null;
  amount: bigint;
  ledgerTransactionId: bigint | null;
}) {
  return {
    provider: l.providerId,
    stakesSantim: l.stakes.toString(),
    winningsSantim: l.winnings.toString(),
    feesSantim: l.fees.toString(),
    resultSantim: l.result.toString(),
    beneficiary: l.beneficiary,
    beneficiaryAgentId: l.beneficiaryAgentId?.toString() ?? null,
    parentLevel: l.parentLevel,
    amountSantim: l.amount.toString(),
    posted: l.ledgerTransactionId !== null,
  };
}

export function periodView(p: SettlementPeriod) {
  return {
    id: p.id.toString(),
    startsAt: p.startsAt.toISOString(),
    endsAt: p.endsAt.toISOString(),
    status: p.status,
    approvedAt: p.approvedAt?.toISOString() ?? null,
    config: p.config,
  };
}
