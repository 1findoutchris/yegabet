/**
 * ETB ↔ santim without floats (CLAUDE.md §5.1). Amounts arrive as a string
 * like "500" or "500.5" or "500.50", or as an integer number of birr.
 */
export function parseEtb(input: unknown): bigint | null {
  const s = typeof input === "number" && Number.isSafeInteger(input) ? String(input) : input;
  if (typeof s !== "string") return null;
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  return BigInt(m[1] as string) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

/** 50000n → "500.00" */
export function formatEtb(santim: bigint): string {
  const sign = santim < 0n ? "-" : "";
  const abs = santim < 0n ? -santim : santim;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
