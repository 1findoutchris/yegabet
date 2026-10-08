import "server-only";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { PROVIDER_META, SPORTSBOOK_GAME_UID } from "@/types/games";
import {
  integrationOf,
  isNegativePolicy,
  providerTotals,
  rateFor,
  wildcardKey,
  type AggRow,
  type RateRow,
  type Totals,
} from "@/lib/providerGgrCore";

/*
 * Provider GGR (admin → Provider GGR), computed from the real wallet ledger.
 *
 * Where the money is recorded — every row is written by exactly one wallet
 * callback, and those are the only writers of BET/WIN/REFUND game rows:
 *
 *   silent    transactions, reference = Silent serial_number.
 *             metadata.bet_amount / win_amount; a round arrives as 2–3
 *             callbacks sharing game_uid + game_round. No rollbacks.
 *   gregmorn  transactions, reference gm:<id>. metadata.bet / win in one
 *             call, round_finished. A rollback writes gm:<id>:rollback
 *             (REFUND), which VOIDS gm:<id>.
 *   octhera   transactions, reference oc:debit|credit|rollback:<txnId>.
 *             debit: betAmount (+ winAmount for bet_win). credit: winAmount
 *             (a win, or a refunded stake). oc:rollback:<txnId> VOIDS the
 *             debit with that txnId. A credit's echoed betAmount is ignored —
 *             counting it would double the stake.
 *
 * Counting rules (so nothing is counted twice):
 *   - Voided bets/rounds are left out of Total Bet and Total Win entirely,
 *     and the rollback rows themselves are never counted; both are reported
 *     as "voided".
 *   - Agent commission rows (…:commission) are not game money.
 *   - Refunds count in Total Win: the stake was taken (Total Bet) and handed
 *     back, so the round nets to zero GGR rather than vanishing.
 *   - A round is dated by its first event and counted once, in that day.
 *     Rounds that started before the range but settle inside it belong to
 *     their own start day: events are read from LOOKBACK_DAYS before the
 *     range so such a tail is recognised rather than counted as a stake-less
 *     win.
 *
 * Provider = integration + the integration's own stable provider code:
 *   silent:<provider>      from game_list/<provider>.json — Silent's catalog
 *                          is one file per provider. Not vendorCode: Silent
 *                          reuses one vendorCode across providers (e.g. 19).
 *   gregmorn:<provider>    from game_list-gregmorn/<provider>.json
 *   octhera:<providerCode> from catalog_games (rows are never deleted)
 * A game id none of these can place is reported under
 * "<integration>:unattributed" — never spread across providers.
 */

export const REPORT_TIMEZONE = () => process.env.REPORT_TIMEZONE || "Africa/Addis_Ababa";

/** How far back events are read to find where a round really started. */
const LOOKBACK_DAYS = 45;
/** How long after the range settlements are still attributed to it. */
const SETTLE_LOOKAHEAD_DAYS = 60;

export const INTEGRATIONS = [
  { id: "octhera", name: "Octhera" },
  { id: "silent", name: "Silent API" },
  { id: "gregmorn", name: "Gregmorn Hub" },
] as const;

type RawRow = {
  integ: string;
  game: string | null;
  currency: string;
  day: string;
  settled: boolean;
  bet: number;
  win: number;
  billable: number;
  rounds: number;
  voided_bet: number;
  voided_rounds: number;
};

/** One row per (integration, game, currency, start day, settled) for rounds that started in the range. */
export async function aggregateRounds(fromDay: string, toDay: string, tz: string): Promise<AggRow[]> {
  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH bounds AS (
      SELECT ((${fromDay}::date - ${LOOKBACK_DAYS}::int)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC' AS lo,
             ((${toDay}::date + ${SETTLE_LOOKAHEAD_DAYS + 1}::int)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC' AS hi
    ),
    ev AS (
      SELECT t.reference, t."createdAt", t.metadata AS m,
             CASE WHEN t.reference LIKE 'gm:%' THEN 'gregmorn'
                  WHEN t.reference LIKE 'oc:%' THEN 'octhera'
                  ELSE 'silent' END AS integ
        FROM "transactions" t, bounds
       WHERE t."status" = 'COMPLETED'
         AND t."type" IN ('BET', 'WIN', 'REFUND')
         AND t."createdAt" >= bounds.lo
         AND t."createdAt" <  bounds.hi
         -- rollback markers and agent commission are not game money
         AND t.reference NOT LIKE '%:rollback'
         AND t.reference NOT LIKE 'oc:rollback:%'
         AND t.reference NOT LIKE '%:commission'
    ),
    norm AS (
      SELECT integ, "createdAt",
             CASE integ WHEN 'silent'   THEN NULLIF(m->>'game_uid', '')
                        WHEN 'gregmorn' THEN NULLIF(m->>'gameId', '')
                        ELSE NULLIF(m->>'gameUid', '') END AS game,
             CASE integ
               WHEN 'silent'   THEN COALESCE('s:' || NULLIF(m->>'game_uid', '') || ':' || NULLIF(m->>'game_round', ''), reference)
               WHEN 'gregmorn' THEN COALESCE('g:' || NULLIF(m->>'gameId', '') || ':' || NULLIF(m->>'roundId', ''), reference)
               ELSE                 COALESCE('o:' || NULLIF(m->>'gameUid', '') || ':' || NULLIF(m->>'gameRound', ''), reference)
             END AS round,
             UPPER(COALESCE(NULLIF(m->>'currency', ''), 'ETB')) AS currency,
             CASE integ
               WHEN 'silent'   THEN COALESCE(NULLIF(m->>'bet_amount', '')::numeric, 0)
               WHEN 'gregmorn' THEN COALESCE(NULLIF(m->>'bet', '')::numeric, 0)
               ELSE CASE WHEN reference LIKE 'oc:debit:%' THEN COALESCE(NULLIF(m->>'betAmount', '')::numeric, 0) ELSE 0 END
             END AS bet,
             CASE integ
               WHEN 'silent'   THEN COALESCE(NULLIF(m->>'win_amount', '')::numeric, 0)
               WHEN 'gregmorn' THEN COALESCE(NULLIF(m->>'win', '')::numeric, 0)
               ELSE COALESCE(NULLIF(m->>'winAmount', '')::numeric, 0)
             END AS win,
             COALESCE((m->>'round_finished') = 'true', false)
               OR COALESCE((m->>'action') = 'bet_win', false) AS finished,
             CASE integ
               WHEN 'gregmorn' THEN EXISTS (SELECT 1 FROM "transactions" v WHERE v.reference = ev.reference || ':rollback')
               WHEN 'octhera'  THEN ev.reference LIKE 'oc:debit:%'
                                AND EXISTS (SELECT 1 FROM "transactions" v WHERE v.reference = 'oc:rollback:' || substr(ev.reference, 10))
               ELSE false
             END AS voided
        FROM ev
       -- Silent: only real callback rows carry bet_amount
       WHERE integ <> 'silent' OR m ? 'bet_amount'
    ),
    rounds AS (
      SELECT integ, round,
             MIN(game) AS game,
             MIN(currency) AS currency,
             MIN("createdAt") AS started,
             COALESCE(SUM(bet) FILTER (WHERE NOT voided), 0) AS bet,
             COALESCE(SUM(win) FILTER (WHERE NOT voided), 0) AS win,
             COALESCE(SUM(bet) FILTER (WHERE voided), 0) AS voided_bet,
             BOOL_AND(voided) AS all_voided,
             COALESCE(BOOL_OR(NOT voided AND (win > 0 OR bet = 0 OR finished)), false) AS has_settle,
             COALESCE(BOOL_OR(COALESCE(game ILIKE '%sports%' OR game = ${SPORTSBOOK_GAME_UID}, false)), false) AS sports
        FROM norm
       GROUP BY integ, round
    ),
    dated AS (
      SELECT *,
             ((started AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date AS day,
             -- casino rounds settle within seconds; one with no settle event
             -- after a day is a loss whose close callback never came
             has_settle OR (NOT sports AND started < (now() AT TIME ZONE 'UTC') - interval '24 hours') AS settled
        FROM rounds
    )
    SELECT integ, game, currency, day::text AS day, settled,
           SUM(bet)::float8 AS bet,
           SUM(win)::float8 AS win,
           SUM(GREATEST(bet - win, 0))::float8 AS billable,
           (COUNT(*) FILTER (WHERE NOT all_voided))::int AS rounds,
           SUM(voided_bet)::float8 AS voided_bet,
           (COUNT(*) FILTER (WHERE all_voided))::int AS voided_rounds
      FROM dated
     WHERE day BETWEEN ${fromDay}::date AND ${toDay}::date
     GROUP BY 1, 2, 3, 4, 5
  `;
  return rows.map((r) => ({
    integration: r.integ,
    gameId: r.game,
    currency: r.currency,
    day: r.day,
    settled: r.settled,
    bet: r.bet,
    win: r.win,
    billable: r.billable,
    rounds: r.rounds,
    voidedBet: r.voided_bet,
    voidedRounds: r.voided_rounds,
  }));
}

// ── provider attribution ────────────────────────────────────────────────────

export type GameInfo = { providerKey: string; providerName: string; gameName: string | null };

const slugCode = (v: unknown) =>
  String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "unattributed";

const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

type FileGame = { code: string; slug: string; name: string };
const fileCache = new Map<string, Map<string, FileGame>>();

/** gameID → provider for one integration's game files in the repo. */
function fileCatalog(dir: "game_list" | "game_list-gregmorn"): Map<string, FileGame> {
  const hit = fileCache.get(dir);
  if (hit) return hit;
  const out = new Map<string, FileGame>();
  // Literal paths, so the standalone build's file tracing ships both folders.
  const abs = dir === "game_list-gregmorn"
    ? path.join(process.cwd(), "game_list-gregmorn")
    : path.join(process.cwd(), "game_list");
  if (fs.existsSync(abs)) {
    for (const file of fs.readdirSync(abs).filter((f) => f.endsWith(".json"))) {
      const slug = file.replace(/\.json$/, "");
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(abs, file), "utf8"));
        const list: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.gameLists) ? parsed.gameLists : [];
        for (const g of list as Record<string, unknown>[]) {
          if (!g?.gameID) continue;
          out.set(String(g.gameID), { code: slugCode(slug), slug, name: String(g.gameNameEn ?? "") });
        }
      } catch {
        /* an unreadable file just attributes nothing */
      }
    }
  }
  fileCache.set(dir, out);
  return out;
}

/** Resolve every (integration, game id) in `rows` to its provider. */
export async function attribute(rows: AggRow[]): Promise<Map<string, GameInfo>> {
  const out = new Map<string, GameInfo>();
  const keyOf = (integ: string, game: string | null) => `${integ}|${game ?? ""}`;
  const unattributed = (integ: string): GameInfo => ({
    providerKey: `${integ}:unattributed`,
    providerName: "Unattributed (game not in catalog)",
    gameName: null,
  });

  const octheraIds = [...new Set(rows.filter((r) => r.integration === "octhera" && r.gameId).map((r) => r.gameId!))];
  const catalog = octheraIds.length
    ? await prisma.catalogGame.findMany({
        where: { source: "octhera", externalId: { in: octheraIds } },
        select: { externalId: true, name: true, providerCode: true, providerName: true },
      })
    : [];
  const byUid = new Map(catalog.map((c) => [c.externalId, c]));

  for (const r of rows) {
    const k = keyOf(r.integration, r.gameId);
    if (out.has(k)) continue;
    if (!r.gameId) { out.set(k, unattributed(r.integration)); continue; }

    if (r.integration === "octhera") {
      const c = byUid.get(r.gameId);
      out.set(k, c
        ? { providerKey: `octhera:${slugCode(c.providerCode || c.providerName)}`, providerName: c.providerName || c.providerCode, gameName: c.name }
        : unattributed("octhera"));
      continue;
    }

    const dir = r.integration === "gregmorn" ? "game_list-gregmorn" : "game_list";
    const g = fileCatalog(dir).get(r.gameId);
    if (!g) { out.set(k, unattributed(r.integration)); continue; }
    const meta = (PROVIDER_META as Record<string, { name?: string } | undefined>)[g.slug];
    out.set(k, {
      providerKey: `${r.integration}:${g.code}`,
      providerName: meta?.name ?? titleCase(g.slug),
      gameName: g.name || null,
    });
  }
  return out;
}

export const gameKey = (r: { integration: string; gameId: string | null }) => `${r.integration}|${r.gameId ?? ""}`;

// ── rates ───────────────────────────────────────────────────────────────────

export async function loadRates(): Promise<RateRow[]> {
  const rows = await prisma.providerFeeRate.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    providerKey: r.providerKey,
    ratePct: Number(r.ratePct),
    policy: isNegativePolicy(r.negativePolicy) ? r.negativePolicy : "net_floor",
    effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
    changedBy: r.changedBy,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Who may change rates: GGR_RATE_EDITORS (comma-separated admin usernames),
 *  defaulting to the primary admin login. Everyone else gets read-only. */
export function canEditRates(username: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!username) return false;
  const list = (env.GGR_RATE_EDITORS ?? env.ADMIN_USERNAME ?? "admin")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(username);
}

// ── assembled views ─────────────────────────────────────────────────────────

export type ProviderLine = Totals & {
  providerKey: string;
  providerName: string;
  integration: string;
  currency: string;
};

/** Every provider × currency with activity in the range. */
export function linesFor(rows: AggRow[], info: Map<string, GameInfo>, rates: RateRow[], toDay: string): ProviderLine[] {
  const groups = new Map<string, { rows: AggRow[]; providerKey: string; providerName: string; currency: string; integration: string }>();
  for (const r of rows) {
    const g = info.get(gameKey(r))!;
    const k = `${g.providerKey}|${r.currency}`;
    const grp = groups.get(k) ?? { rows: [], providerKey: g.providerKey, providerName: g.providerName, currency: r.currency, integration: r.integration };
    grp.rows.push(r);
    groups.set(k, grp);
  }
  return [...groups.values()]
    .map((g) => ({
      providerKey: g.providerKey,
      providerName: g.providerName,
      integration: g.integration,
      currency: g.currency,
      ...providerTotals(g.rows, g.providerKey, rates, toDay),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.ggr - a.ggr || a.providerName.localeCompare(b.providerName));
}

/** Integration-wide defaults currently in force (for the overview's editor). */
export function currentDefaults(rates: RateRow[], today: string) {
  return INTEGRATIONS.map((i) => ({
    integration: i.id,
    name: i.name,
    providerKey: wildcardKey(i.id),
    rate: rateFor(wildcardKey(i.id), today, rates),
  }));
}

export { integrationOf };
