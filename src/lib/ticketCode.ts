/*
 * Ticket code formats — pure, shared by server lookup and client display.
 *
 * Stored codes keep their hyphen (T-3F9K2A agent tickets, P-7KX2M9QD player
 * bets). Screens, paper and the printed barcode show them without it
 * (T3F9K2A), so lookup accepts either spelling and maps both to the stored one.
 */

/** "t-3f9k2a ", "T3F9K2A" → "T-3F9K2A"; anything not shaped like a code → null. */
export function normalizeCode(raw: string): string | null {
  const m = /^([TP])-?([A-Z0-9]{6,10})$/.exec(raw.replace(/\s+/g, "").toUpperCase());
  return m ? `${m[1]}-${m[2]}` : null;
}

/** How a code is shown and printed: "T-3F9K2A" → "T3F9K2A". Display only. */
export function displayCode(code: string): string {
  return code.replace(/-/g, "");
}
