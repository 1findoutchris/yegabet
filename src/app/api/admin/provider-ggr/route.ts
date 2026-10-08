import { NextRequest, NextResponse } from "next/server";
import { adminUsername, requireAdminAuth } from "@/lib/adminAuth";
import { aggregateRounds, attribute, canEditRates, currentDefaults, linesFor, loadRates } from "@/lib/providerGgr";
import { reportRange } from "@/lib/providerGgrReport";

/**
 * GET ?period=today|yesterday|week|month|custom[&from&to] — every provider's
 * Total Bet / Total Win / GGR / fee / remaining over the range, one table per
 * currency (currencies are never added together).
 */
export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const range = reportRange(req);
  if (!range) return NextResponse.json({ error: "Invalid date range" }, { status: 400 });

  const [rows, rates, username] = await Promise.all([
    aggregateRounds(range.fromDay, range.toDay, range.tz),
    loadRates(),
    adminUsername(req),
  ]);
  const info = await attribute(rows);
  const lines = linesFor(rows, info, rates, range.toDay);

  const currencies = [...new Set(lines.map((l) => l.currency))].map((currency) => {
    const ls = lines.filter((l) => l.currency === currency);
    const add = (k: "totalBet" | "totalWin" | "ggr" | "fee" | "remaining" | "unsettledBet" | "voidedBet") =>
      Math.round(ls.reduce((s, l) => s + l[k], 0) * 100) / 100;
    return {
      currency,
      lines: ls,
      totals: {
        totalBet: add("totalBet"), totalWin: add("totalWin"), ggr: add("ggr"), fee: add("fee"),
        remaining: add("remaining"), unsettledBet: add("unsettledBet"), voidedBet: add("voidedBet"),
      },
    };
  });

  return NextResponse.json({
    ...range,
    canEdit: canEditRates(username),
    currencies,
    defaults: currentDefaults(rates, range.today),
  });
}
