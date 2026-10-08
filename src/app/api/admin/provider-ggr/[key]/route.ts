import { NextRequest, NextResponse } from "next/server";
import { adminUsername, requireAdminAuth } from "@/lib/adminAuth";
import {
  aggregateRounds, attribute, canEditRates, gameKey, linesFor, loadRates,
} from "@/lib/providerGgr";
import { daysBetween, integrationOf, PROVIDER_KEY, providerTotals, rateFor, wildcardKey } from "@/lib/providerGgrCore";
import { reportRange } from "@/lib/providerGgrReport";

/**
 * GET — one provider over the same range as the overview: its totals per
 * currency, the rates that applied (history included), and breakdowns by
 * game and by day.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const providerKey = decodeURIComponent((await params).key);
  if (!PROVIDER_KEY.test(providerKey) && !/^(silent|gregmorn|octhera):unattributed$/.test(providerKey)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }
  const range = reportRange(req);
  if (!range) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });

  const [all, rates, username] = await Promise.all([
    aggregateRounds(range.fromDay, range.toDay, range.tz),
    loadRates(),
    adminUsername(req),
  ]);
  const info = await attribute(all);
  const rows = all.filter((r) => info.get(gameKey(r))!.providerKey === providerKey);
  const name = rows.length ? info.get(gameKey(rows[0]))!.providerName : null;
  const currencies = [...new Set(rows.map((r) => r.currency))].sort();

  const byCurrency = currencies.map((currency) => {
    const cr = rows.filter((r) => r.currency === currency);

    // By game: each game's own figures under this provider's rates.
    const games = new Map<string, typeof cr>();
    for (const r of cr) games.set(r.gameId ?? "", [...(games.get(r.gameId ?? "") ?? []), r]);
    const byGame = [...games.entries()]
      .map(([gameId, gr]) => ({
        gameId: gameId || null,
        gameName: info.get(gameKey(gr[0]))!.gameName,
        ...providerTotals(gr, providerKey, rates, range.toDay),
      }))
      .sort((a, b) => b.totalBet - a.totalBet);

    // By day: every day of the range, with the rate in force that day.
    const byDay = daysBetween(range.fromDay, range.toDay).map((day) => {
      const dr = cr.filter((r) => r.day === day);
      const rate = rateFor(providerKey, day, rates);
      return { day, rateId: rate?.id ?? null, ratePct: rate?.ratePct ?? null, policy: rate?.policy ?? null, ...providerTotals(dr, providerKey, rates, day) };
    });

    return { currency, totals: linesFor(cr, info, rates, range.toDay)[0], byGame, byDay };
  });

  const integration = integrationOf(providerKey);
  return NextResponse.json({
    ...range,
    providerKey,
    providerName: name,
    integration,
    canEdit: canEditRates(username) && !providerKey.endsWith(":unattributed"),
    currentRate: rateFor(providerKey, range.today, rates),
    rateHistory: rates
      .filter((r) => r.providerKey === providerKey || r.providerKey === wildcardKey(integration))
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt)),
    currencies: byCurrency,
  });
}
