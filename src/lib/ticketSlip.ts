/*
 * Bet-slip selections read back out of a TicketBet's provider `info` blob.
 *
 * Shared by the printable ticket (client), the re-bet API (server) and the
 * re-bet checklist on /sports — no server-only imports, no Prisma.
 *
 * Rendered in the convention bettors know from the BetBy slip:
 *
 *   Netherlands - Germany
 *   1x2 Netherlands
 *   Odds: 2.54
 *
 * The exact shape is provider-defined, so beyond the verified BetBy shape we
 * walk it looking for objects that smell like selections — a name/teams field
 * plus an odds or pick field. Anything unrecognized just yields no selections.
 */

export interface SlipSelection {
  match: string;
  marketPick: string | null;
  odds: string | null;
  kickoff: string | null;
  /** Kickoff as epoch ms — what the re-bet check compares against "now". */
  startsAt: number | null;
}

export interface Slip {
  selections: SlipSelection[];
  totalOdds: string | null;
  betType: string | null;
}

/* start_ts is Unix seconds; a plain date string is parsed. */
function parseKickoff(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 1e9) return n * 1000;
  const t = new Date(raw).getTime();
  return isNaN(t) ? null : t;
}

function formatKickoff(raw: string | null): string | null {
  if (!raw) return null;
  const ms = parseKickoff(raw);
  if (ms === null) return raw;
  return new Date(ms).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
        const kickoffRaw = text(l.start_ts) ?? pick(l, DATE_KEYS);
        return {
          match,
          marketPick: [market, pickText].filter(Boolean).join(" ") || null,
          odds: text(l.coeficient) ?? pick(l, ODDS_KEYS),
          kickoff: formatKickoff(kickoffRaw),
          startsAt: parseKickoff(kickoffRaw),
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
      const kickoffRaw = pick(o, DATE_KEYS);
      selections.push({
        match: pick(o, NAME_KEYS)!,
        marketPick: [market, pickText].filter(Boolean).join(" ") || null,
        odds: pick(o, ODDS_KEYS),
        kickoff: formatKickoff(kickoffRaw),
        startsAt: parseKickoff(kickoffRaw),
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

// ── Re-bet ("Bet this ticket") ───────────────────────────────────────────────
/*
 * A copied ticket uses the original's selections as a TEMPLATE only. The
 * sportsbook (BetBy, in an iframe) is the one place that knows current odds and
 * market state, and the only place a bet can be placed — so the agent rebuilds
 * the slip there, and this compares what actually got placed on the new ticket
 * against the template, leg by leg.
 *
 * Legs are matched on match + market/pick text: the provider callback carries
 * no event/market/outcome ids (see docs/in-person-agents.md).
 */

export type RebetLegState =
  | "pending"       // not on the new ticket yet — add it in the sportsbook
  | "started"       // not on the new ticket and kickoff has passed — skip it
  | "placed"        // on the new ticket at the original odds
  | "odds_changed"; // on the new ticket at different odds

export interface RebetLeg {
  match: string;
  marketPick: string | null;
  kickoff: string | null;
  oldOdds: string | null;
  newOdds: string | null;
  state: RebetLegState;
}

export interface RebetComparison {
  legs: RebetLeg[];
  /** Repeat selections on the original, merged into one leg. */
  duplicatesMerged: number;
  /** Selections on the new ticket that weren't on the original. */
  extraPlaced: number;
}

const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function selectionKey(s: Pick<SlipSelection, "match" | "marketPick">): string {
  return `${norm(s.match)}|${norm(s.marketPick)}`;
}

/** Every selection across a ticket's bets, in order. */
export function ticketSelections(bets: { info: unknown }[]): SlipSelection[] {
  return bets.flatMap((b) => parseSlip(b.info).selections);
}

/** The original's selections with exact repeats merged (first occurrence wins). */
export function templateSelections(bets: { info: unknown }[]): { legs: SlipSelection[]; duplicatesMerged: number } {
  const all = ticketSelections(bets);
  const seen = new Set<string>();
  const legs = all.filter((s) => {
    const k = selectionKey(s);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { legs, duplicatesMerged: all.length - legs.length };
}

/** A leg can still be bet pre-match only if its kickoff is unknown or ahead. */
export function hasStarted(s: SlipSelection, nowMs: number): boolean {
  return s.startsAt !== null && s.startsAt <= nowMs;
}

function sameOdds(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) < 1e-9 : a === b;
}

export function compareRebet(
  originalBets: { info: unknown }[],
  newBets: { info: unknown }[],
  nowMs: number
): RebetComparison {
  const { legs: template, duplicatesMerged } = templateSelections(originalBets);
  const placed = new Map<string, SlipSelection>();
  for (const s of ticketSelections(newBets)) placed.set(selectionKey(s), s);

  const templateKeys = new Set(template.map(selectionKey));
  const extraPlaced = [...placed.keys()].filter((k) => !templateKeys.has(k)).length;

  const legs = template.map((t): RebetLeg => {
    const p = placed.get(selectionKey(t));
    const base = { match: t.match, marketPick: t.marketPick, kickoff: t.kickoff, oldOdds: t.odds };
    if (p) return { ...base, newOdds: p.odds, state: sameOdds(t.odds, p.odds) ? "placed" : "odds_changed" };
    return { ...base, newOdds: null, state: hasStarted(t, nowMs) ? "started" : "pending" };
  });

  return { legs, duplicatesMerged, extraPlaced };
}
