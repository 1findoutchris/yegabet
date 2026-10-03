/*
 * Bet-slip selections read back out of a provider `info` payload. Shared by
 * the agent's printable ticket and the player's own ticket history — no
 * server-only imports.
 */

/*
 * Best-effort extraction of bet-slip selections from the provider's `info`
 * blob, rendered in the convention bettors know from the BetBy slip:
 *
 *   Netherlands - Germany
 *   1x2 Netherlands
 *   Odds: 2.54
 *
 * The exact shape is provider-defined, so we walk it looking for objects that
 * smell like selections — a name/teams field plus an odds or pick field.
 * Anything unrecognized just yields no selections; the game name still shows.
 */
export interface SlipSelection {
  match: string;
  marketPick: string | null;
  odds: string | null;
  kickoff: string | null;
  /** This match's own result, when the provider reports it (BetBy legs only). */
  result: LegResult | null;
}

export type LegResult = "open" | "won" | "lost";

/*
 * BetBy leg `outcome` codes. 0 and 2 verified against a real settled ticket
 * (open / lost legs on a lost combo); 1 = won is BetBy's convention. Any other
 * code (void, half-win, …) shows no mark rather than a guessed one.
 */
function legResult(outcome: unknown): LegResult | null {
  const n = typeof outcome === "number" ? outcome : typeof outcome === "string" && outcome !== "" ? Number(outcome) : NaN;
  return n === 0 ? "open" : n === 1 ? "won" : n === 2 ? "lost" : null;
}

/* start_ts is Unix seconds; a plain date string is shown as-is. */
function formatKickoff(raw: string | null): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 1e9) {
    const d = new Date(n * 1000);
    if (!isNaN(d.getTime()))
      return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  const d = new Date(raw);
  if (!isNaN(d.getTime()))
    return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return raw;
}

export interface Slip {
  selections: SlipSelection[];
  totalOdds: string | null;
  betType: string | null;
}

export function parseSlip(info: unknown): Slip {
  const empty: Slip = { selections: [], totalOdds: null, betType: null };
  let data = info;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return empty; }
  }
  if (!data || typeof data !== "object") return empty;

  const selections: SlipSelection[] = [];
  const seen = new Set<unknown>();
  let totalOdds: string | null = null;
  let betType: string | null = null;

  const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : null);
  const pick = (o: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) {
      const s = text(o[k]);
      if (s) return s;
    }
    return null;
  };

  const NAME_KEYS = ["match", "event", "eventName", "game", "gameName", "title", "name", "teams", "fixture"];
  const MARKET_KEYS = ["market", "marketName", "market_type_name", "betType", "type"];
  const PICK_KEYS = ["pick", "selection", "outcome", "choice", "bet", "outcomeName", "selectionName", "outcome_display_name"];
  // Handicap/total line values ("-1.5", "2.5") — may arrive separately from
  // the pick text; without them a handicap bet reads wrong.
  const LINE_KEYS = ["line", "param", "parameter", "handicap", "base", "total", "points", "value", "lineValue"];
  const ODDS_KEYS = ["odds", "odd", "price", "coefficient", "coef", "coeficient"];
  const TOTAL_ODDS_KEYS = ["totalOdds", "total_odds", "combinedOdds", "accOdds"];
  const TYPE_KEYS = ["type", "betType", "slipType", "mode"];
  // Kickoff/match start — BetBy legs carry it as `start_ts` (Unix seconds).
  const DATE_KEYS = ["start_ts", "startTime", "start_time", "event_time", "event_date", "kickoff", "date"];

  /*
   * Real Gregmorn/BetBy shape (verified against prod): `info` arrives as a
   * JSON string; its `detail` field is ANOTHER JSON string carrying
   * `legs[]` — team1/team2, market_type_name, outcome_display_name,
   * coeficient (their typo), handicap/base for line values. `k` = total odds.
   */
  const root = data as Record<string, unknown>;
  let detail: unknown = root.detail;
  if (typeof detail === "string") {
    try { detail = JSON.parse(detail); } catch { detail = null; }
  }
  const legs = (detail as Record<string, unknown> | null)?.legs;
  if (Array.isArray(legs) && legs.length > 0) {
    const d = detail as Record<string, unknown>;
    return {
      selections: legs.map((leg) => {
        const l = leg as Record<string, unknown>;
        const match =
          [text(l.team1), text(l.team2)].filter(Boolean).join(" - ") ||
          pick(l, NAME_KEYS) ||
          "Selection";
        const market = text(l.market_type_name) ?? pick(l, MARKET_KEYS);
        const sel = text(l.outcome_display_name) ?? pick(l, PICK_KEYS);
        const line = text(l.handicap) ?? text(l.base);
        const pickText = line && !(sel ?? "").includes(line) ? `(${line}) ${sel ?? ""}`.trim() : sel;
        return {
          match,
          marketPick: [market, pickText].filter(Boolean).join(" ") || null,
          odds: text(l.coeficient) ?? pick(l, ODDS_KEYS),
          kickoff: formatKickoff(text(l.start_ts) ?? pick(l, DATE_KEYS)),
          result: legResult(l.outcome),
        };
      }),
      totalOdds: text(d.k) ?? pick(d, TOTAL_ODDS_KEYS),
      betType: legs.length > 1 ? "Combo" : "Single",
    };
  }

  function looksLikeSelection(o: Record<string, unknown>): boolean {
    return NAME_KEYS.some((k) => text(o[k])) && (ODDS_KEYS.some((k) => text(o[k])) || PICK_KEYS.some((k) => text(o[k])));
  }

  function walk(v: unknown, depth: number) {
    if (!v || typeof v !== "object" || seen.has(v) || depth > 8) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    const o = v as Record<string, unknown>;
    if (looksLikeSelection(o)) {
      const market = pick(o, MARKET_KEYS);
      const sel = pick(o, PICK_KEYS);
      const line = pick(o, LINE_KEYS);
      // BetBy convention: "Handicap (-1.5) Netherlands", "Total over 2.5".
      // If the pick already carries the line ("over 2.5") don't double it.
      const pickText = line && !(sel ?? "").includes(line) ? `(${line}) ${sel ?? ""}`.trim() : sel;
      selections.push({
        match: pick(o, NAME_KEYS)!,
        marketPick: [market, pickText].filter(Boolean).join(" ") || null,
        odds: pick(o, ODDS_KEYS),
        kickoff: formatKickoff(pick(o, DATE_KEYS)),
        result: null,
      });
      return; // don't double-count nested dupes of the same selection
    }
    // Top-level slip metadata — first match wins, shallow levels only.
    if (!totalOdds) totalOdds = pick(o, TOTAL_ODDS_KEYS);
    if (!betType) {
      const t = pick(o, TYPE_KEYS);
      if (t && t.length < 20) betType = t;
    }
    Object.values(o).forEach((x) => walk(x, depth + 1));
  }
  walk(data, 0);
  return { selections, totalOdds, betType };
}

const selectionKey = (s: SlipSelection) => `${s.match}|${s.marketPick ?? ""}`.toLowerCase();

/**
 * Per-match results for a bet. The placement payload carries every leg as
 * open; once the ticket is decided the provider re-sends the legs with their
 * results (`resultInfo`, from the settle callback). Results come from that
 * when present. A settled bet with no settle payload gets no marks — the
 * placement's "open" would be stale.
 */
export function withResults(slip: Slip, resultInfo: unknown, settled: boolean): SlipSelection[] {
  const results = resultInfo != null ? parseSlip(resultInfo).selections : [];
  if (results.length === 0) {
    return settled ? slip.selections.map((s) => ({ ...s, result: null })) : slip.selections;
  }
  const byKey = new Map(results.map((r) => [selectionKey(r), r.result]));
  return slip.selections.map((s) => ({ ...s, result: byKey.get(selectionKey(s)) ?? null }));
}

/*
 * Last-resort rendering for an unrecognized payload: prefer the nested
 * `detail` blob (that's where the bet data lives), else the whole thing.
 * Keeps the printout useful — and the failure visible — instead of blank.
 */
export function rawInfoText(info: unknown): string {
  let data = info;
  if (typeof data === "string") {
    const raw = data;
    try { data = JSON.parse(raw); } catch { return raw; }
  }
  if (data && typeof data === "object") {
    let detail = (data as Record<string, unknown>).detail;
    if (typeof detail === "string") {
      try { detail = JSON.parse(detail); } catch { /* keep raw string */ }
    }
    return JSON.stringify(detail ?? data, null, 1).slice(0, 2000);
  }
  return String(data);
}
