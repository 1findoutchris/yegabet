import { describe, expect, it } from "vitest";
import { displayCode, normalizeCode } from "@/lib/ticketCode";

describe("normalizeCode", () => {
  it.each([
    ["T-3F9K2A", "T-3F9K2A"],
    ["t-3f9k2a ", "T-3F9K2A"],
    ["T3F9K2A", "T-3F9K2A"],
    ["tbz4ekm", "T-BZ4EKM"],
    ["P-7KX2M9QD", "P-7KX2M9QD"],
    ["P7KX2M9QD", "P-7KX2M9QD"],
    [" p 7kx2 m9qd", "P-7KX2M9QD"],
  ])("%j → %s", (raw, code) => {
    expect(normalizeCode(raw)).toBe(code);
  });

  it.each(["", "T-", "X-3F9K2A", "T-3F9K", "T--3F9K2A", "T-3F9K2A!", "T-3F9K2A3F9K2A"])("rejects %j", (raw) => {
    expect(normalizeCode(raw)).toBeNull();
  });
});

describe("displayCode", () => {
  it("drops hyphens for display", () => {
    expect(displayCode("T-BZ4EKM")).toBe("TBZ4EKM");
    expect(displayCode(normalizeCode("TBZ4EKM")!)).toBe("TBZ4EKM");
  });
});
