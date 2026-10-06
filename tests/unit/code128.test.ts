import { describe, expect, it } from "vitest";
import { code128B } from "@/lib/code128";

describe("code128B", () => {
  // Reference bar patterns from python-barcode's Code128 for the same text.
  it.each([
    ["TUYE25F", "1101001000011011100010110111011101110110100010001101000110011100101101110010010001100010101000110001100011101011"],
    ["P2BW4TGZX", "11010010000111011101101100111001010001011000111010001101100100111011011100010110100010001110110001011100010110110110011001100011101011"],
    ["PAD9X", "110100100001110111011010100011000101100010001110010110011100010110111100100101100011101011"],
  ])("encodes %s", (text, bits) => {
    expect(code128B(text)).toBe(bits);
  });

  it("is start B + 11 modules per char + check + 13-module stop", () => {
    expect(code128B("TUYE25F")).toHaveLength(11 + 7 * 11 + 11 + 13);
  });

  it("rejects characters outside code set B", () => {
    expect(() => code128B("Tü")).toThrow();
  });
});
