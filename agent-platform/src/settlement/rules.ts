import type { PrismaClient } from "@prisma/client";
import { configAt } from "../config/configVersions";

/**
 * Settlement rules: nothing hardcoded (owner, 2026-10-20: "I may change some
 * rules"). Every rule is dated config; the version in force at a period's end
 * is used and recorded on the period. Percentages are basis points (1% = 100)
 * so no float ever touches a share.
 */

export interface Split {
  agentBp: number;
  companyBp: number;
  providerBp: number;
  /** Parent level 1, 2, 3… A level past the tree's depth goes to the company. */
  parentsBp: number[];
}

export interface Rules {
  split: Split;
  maxParentLevels: number;
  periodDays: number;
  roundingUnitSantim: number;
  paymentFees: { mode: "none" };
  firstPeriodStart: Date;
  /** Config version ids used, recorded on the period. */
  versions: Record<string, string>;
}

export class RulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RulesError";
  }
}

const bp = (v: unknown, name: string): number => {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 10_000) {
    throw new RulesError(`${name} must be a whole number of basis points between 0 and 10000`);
  }
  return v as number;
};

/** Validators per config key, used when reading rules and when the owner writes a new version. */
export const VALIDATORS: Record<string, (v: unknown) => unknown> = {
  "commission.split": (v) => {
    const o = (v ?? {}) as Record<string, unknown>;
    if (!Array.isArray(o.parentsBp) || o.parentsBp.length > 10) {
      throw new RulesError("parentsBp must be a list of up to 10 shares");
    }
    const split: Split = {
      agentBp: bp(o.agentBp, "agentBp"),
      companyBp: bp(o.companyBp, "companyBp"),
      providerBp: bp(o.providerBp, "providerBp"),
      parentsBp: o.parentsBp.map((p, i) => bp(p, `parentsBp[${i}]`)),
    };
    const total =
      split.agentBp + split.companyBp + split.providerBp + split.parentsBp.reduce((s, p) => s + p, 0);
    if (total !== 10_000) throw new RulesError(`the split must add up to 100% (10000 bp), not ${total}`);
    return split;
  },
  "settlement.max_parent_levels": (v) => {
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 10)
      throw new RulesError("max_parent_levels: 0–10");
    return v;
  },
  "settlement.period_days": (v) => {
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 90)
      throw new RulesError("period_days: 1–90");
    return v;
  },
  "settlement.rounding_unit_santim": (v) => {
    if (v !== 1 && v !== 100) throw new RulesError("rounding_unit_santim: 1 (santim) or 100 (whole birr)");
    return v;
  },
  "settlement.payment_fees": (v) => {
    if ((v as { mode?: unknown })?.mode !== "none") {
      throw new RulesError('payment_fees: only {"mode":"none"} until the fees are defined (Q-03b)');
    }
    return v;
  },
  "settlement.first_period_start": (v) => {
    if (typeof v !== "string" || Number.isNaN(Date.parse(v)))
      throw new RulesError("first_period_start: an ISO date");
    return v;
  },
};

/** The rules in force at `at`. Refuses (RulesError) if any rule is missing or invalid: no defaults for money. */
export async function rulesAt(db: PrismaClient, at: Date): Promise<Rules> {
  const read = async (key: string) => {
    const row = await configAt(db, key, at);
    if (!row) throw new RulesError(`${key} is not configured`);
    return { value: VALIDATORS[key]?.(row.value), id: row.id.toString() };
  };
  const split = await read("commission.split");
  const levels = await read("settlement.max_parent_levels");
  const days = await read("settlement.period_days");
  const unit = await read("settlement.rounding_unit_santim");
  const fees = await read("settlement.payment_fees");
  const first = await read("settlement.first_period_start");
  return {
    split: split.value as Split,
    maxParentLevels: levels.value as number,
    periodDays: days.value as number,
    roundingUnitSantim: unit.value as number,
    paymentFees: fees.value as { mode: "none" },
    firstPeriodStart: new Date(first.value as string),
    versions: {
      "commission.split": split.id,
      "settlement.max_parent_levels": levels.id,
      "settlement.period_days": days.id,
      "settlement.rounding_unit_santim": unit.id,
      "settlement.payment_fees": fees.id,
      "settlement.first_period_start": first.id,
    },
  };
}

export interface Share {
  beneficiary: "agent" | "company" | "provider" | "parent";
  beneficiaryAgentId: bigint | null;
  parentLevel: number | null;
  amount: bigint;
}

/**
 * Split a positive result G (santim) by the rules (§2, §5.10):
 * every share is floored to the rounding unit; the remainder, and the share of
 * any parent level the tree doesn't have (or past maxParentLevels), go to the company.
 * `ancestors` is root … direct parent.
 */
export function split(
  g: bigint,
  rules: Pick<Rules, "split" | "maxParentLevels" | "roundingUnitSantim">,
  ancestors: bigint[],
): Share[] {
  const unit = BigInt(rules.roundingUnitSantim);
  const floor = (part: number) => ((g * BigInt(part)) / 10_000n / unit) * unit;
  const shares: Share[] = [
    { beneficiary: "agent", beneficiaryAgentId: null, parentLevel: null, amount: floor(rules.split.agentBp) },
    {
      beneficiary: "provider",
      beneficiaryAgentId: null,
      parentLevel: null,
      amount: floor(rules.split.providerBp),
    },
  ];
  rules.split.parentsBp.forEach((part, i) => {
    const level = i + 1;
    const parent = level <= rules.maxParentLevels ? ancestors[ancestors.length - level] : undefined;
    if (parent !== undefined) {
      shares.push({
        beneficiary: "parent",
        beneficiaryAgentId: parent,
        parentLevel: level,
        amount: floor(part),
      });
    }
  });
  const given = shares.reduce((s, x) => s + x.amount, 0n);
  shares.push({ beneficiary: "company", beneficiaryAgentId: null, parentLevel: null, amount: g - given });
  return shares;
}
