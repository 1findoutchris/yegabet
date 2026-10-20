import { messageOf } from "../../web/src/lib/api";
import { formatSantim, isAmount } from "../../web/src/lib/money";

describe("web: money on screen", () => {
  it("formats santim strings without floats", () => {
    expect(formatSantim("123456")).toBe("1,234.56");
    expect(formatSantim("5")).toBe("0.05");
    expect(formatSantim("-1076543")).toBe("-10,765.43");
    expect(formatSantim(100_000_000_000n)).toBe("1,000,000,000.00");
  });
  it("accepts the same amounts the server does", () => {
    for (const ok of ["500", "500.5", "500.50", " 15 "]) expect(isAmount(ok)).toBe(true);
    for (const bad of ["1,000", "12.345", "-5", "abc", ""]) expect(isAmount(bad)).toBe(false);
  });
});

describe("web: error messages", () => {
  it("shows the server's message, or a plain one", () => {
    expect(messageOf(400, { message: "deposits must be between 15 and 100000 ETB" })).toBe(
      "deposits must be between 15 and 100000 ETB",
    );
    expect(messageOf(400, { message: ["a", "b"] })).toBe("a, b");
    expect(messageOf(401, null)).toBe("Please log in again.");
    expect(messageOf(429, {})).toMatch(/wait a minute/);
    expect(messageOf(500, { message: "" })).toMatch(/Something went wrong/);
  });
});
