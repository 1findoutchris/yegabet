import { formatEtb, parseEtb } from "../../src/deposits/money";
import { maskReference, normalizeReference } from "../../src/deposits/deposits";

describe("ETB amounts", () => {
  it.each([
    ["500", 50_000n],
    ["500.5", 50_050n],
    ["500.50", 50_050n],
    [" 15 ", 1_500n],
    [100_000, 10_000_000n],
    ["0", 0n],
  ])("parses %p as %p santim", (input, out) => {
    expect(parseEtb(input)).toBe(out);
  });

  it.each(["1,000", "12.345", "-5", "abc", "", "1e3", 12.5, null, undefined, {}, 2 ** 60])(
    "refuses %p",
    (input) => {
      expect(parseEtb(input)).toBeNull();
    },
  );

  it("formats santim", () => {
    expect(formatEtb(50_000n)).toBe("500.00");
    expect(formatEtb(5n)).toBe("0.05");
    expect(formatEtb(-12_345n)).toBe("-123.45");
  });
});

describe("references", () => {
  it("normalizes spelling and masks for display", () => {
    expect(normalizeReference(" chk 123-45 ")).toBe("CHK12345");
    expect(maskReference("CHK12345")).toBe("****2345");
    expect(() => normalizeReference("x".repeat(65))).toThrow(/transaction reference/);
  });
});
