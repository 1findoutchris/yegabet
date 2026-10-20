import fc from "fast-check";
import { RulesError, VALIDATORS, split, type Split } from "../../src/settlement/rules";

const OWNER_SPLIT: Split = { agentBp: 6000, companyBp: 1000, providerBp: 1000, parentsBp: [1000, 500, 500] };
const rules = { split: OWNER_SPLIT, maxParentLevels: 3, roundingUnitSantim: 100 };
const amounts = (g: bigint, anc: bigint[], r = rules) =>
  Object.fromEntries(split(g, r, anc).map((s) => [`${s.beneficiary}${s.parentLevel ?? ""}`, s.amount]));

describe("split (owner's worked example, 2026-10-20)", () => {
  it("G = 10,765.43 with 3 parents", () => {
    expect(amounts(1_076_543n, [1n, 2n, 3n])).toEqual({
      agent: 645_900n,
      provider: 107_600n,
      parent1: 107_600n,
      parent2: 53_800n,
      parent3: 53_800n,
      company: 107_843n,
    });
  });

  it("parent levels go to the nearest parent first, and missing ones to the company", () => {
    const s = split(1_076_543n, rules, [10n, 20n]);
    expect(s.find((x) => x.parentLevel === 1)?.beneficiaryAgentId).toBe(20n); // direct parent
    expect(s.find((x) => x.parentLevel === 2)?.beneficiaryAgentId).toBe(10n);
    expect(amounts(1_076_543n, [10n, 20n]).company).toBe(161_643n);
    expect(amounts(1_076_543n, []).company).toBe(1_076_543n - 645_900n - 107_600n);
  });

  it("respects max_parent_levels and santim rounding", () => {
    expect(amounts(1_076_543n, [1n, 2n, 3n], { ...rules, maxParentLevels: 2 }).company).toBe(
      107_843n + 53_800n,
    );
    expect(amounts(1_076_543n, [1n, 2n, 3n], { ...rules, roundingUnitSantim: 1 })).toMatchObject({
      agent: 645_925n,
      parent2: 53_827n,
    });
  });

  it("property: shares always add up to G exactly and none is negative", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.array(fc.bigInt({ min: 1n, max: 1000n }), { maxLength: 5 }),
        fc.constantFrom(1, 100),
        fc.integer({ min: 0, max: 5 }),
        (g, anc, unit, levels) => {
          const s = split(g, { ...rules, roundingUnitSantim: unit, maxParentLevels: levels }, anc);
          expect(s.reduce((t, x) => t + x.amount, 0n)).toBe(g);
          expect(s.every((x) => x.amount >= 0n)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("validators (the owner can change rules; broken ones are refused)", () => {
  const bad = (key: string, v: unknown) => expect(() => VALIDATORS[key]?.(v)).toThrow(RulesError);
  it("accepts valid values", () => {
    expect(VALIDATORS["commission.split"]?.(OWNER_SPLIT)).toEqual(OWNER_SPLIT);
    expect(VALIDATORS["settlement.max_parent_levels"]?.(3)).toBe(3);
    expect(VALIDATORS["settlement.period_days"]?.(10)).toBe(10);
    expect(VALIDATORS["settlement.rounding_unit_santim"]?.(1)).toBe(1);
    expect(VALIDATORS["settlement.payment_fees"]?.({ mode: "none" })).toEqual({ mode: "none" });
    expect(VALIDATORS["settlement.first_period_start"]?.("2026-10-21T00:00:00+03:00")).toBeTruthy();
  });
  it("refuses splits that don't add to 100%, fractional or negative shares, bad lists", () => {
    bad("commission.split", { ...OWNER_SPLIT, agentBp: 5900 });
    bad("commission.split", { ...OWNER_SPLIT, agentBp: 59.5 });
    bad("commission.split", { ...OWNER_SPLIT, companyBp: -1 });
    bad("commission.split", { ...OWNER_SPLIT, parentsBp: "10%" });
    bad("commission.split", { ...OWNER_SPLIT, parentsBp: Array(11).fill(0) });
    bad("commission.split", { ...OWNER_SPLIT, parentsBp: [1000, 500, 20_000] });
    bad("commission.split", null);
  });
  it("refuses out-of-range numbers, unknown fee modes and bad dates", () => {
    bad("settlement.max_parent_levels", 11);
    bad("settlement.max_parent_levels", "3");
    bad("settlement.period_days", 0);
    bad("settlement.period_days", 91);
    bad("settlement.rounding_unit_santim", 10);
    bad("settlement.payment_fees", { mode: "percent" });
    bad("settlement.payment_fees", null);
    bad("settlement.first_period_start", "tomorrow");
    bad("settlement.first_period_start", 5);
  });
});
