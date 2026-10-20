/**
 * Money on screen. The API sends santim as strings (bigint-safe); we format
 * without ever turning them into floats.
 */

/** "123456" → "1,234.56" */
export function formatSantim(santim: string | bigint): string {
  let v = typeof santim === "bigint" ? santim : BigInt(santim);
  const negative = v < 0n;
  if (negative) v = -v;
  const birr = (v / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${birr}.${(v % 100n).toString().padStart(2, "0")}`;
}

/** Same check the server makes: whole birr or up to 2 decimals. */
export function isAmount(input: string): boolean {
  return /^\d{1,12}(\.\d{1,2})?$/.test(input.trim());
}

export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
