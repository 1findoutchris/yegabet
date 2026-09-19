import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth } from "@/lib/adminAuth";
import { dayKey, resolveRange } from "@/lib/adminRange";
import { ggrSplit, sumBuckets, SILENT_GGR_RATE, GgrBucket } from "@/lib/ggr";

export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const { period, from, to } = resolveRange(searchParams);

  // Aggregated in Postgres, not in JS: a busy month is >200k BET/WIN rows, and
  // this page only ever shows one number per day. Casts keep the driver from
  // handing back Decimal/BigInt, which JSON.stringify can't serialize.
  //
  // Summed off the stored callback payload, not "amount": the row only keeps
  // |win − bet|, so the gross stake and payout live in metadata.
  //
  // GREATEST() on the ROUND, after the inner GROUP BY, is the fee Silent API
  // actually charges: 10% of what the house kept on each round it won, 0 on a
  // round the player won, never netted between them. Verified against their
  // Game_Transactions export — see the note in src/lib/ggr.ts.
  //
  // The inner GROUP BY is what makes a round a round. One spin arrives as two or
  // three callbacks — the stake, then the win, then usually a 0/0 close — and
  // each is its own row, so the stake row on a round the player went on to win
  // still reads bet>0, win=0 on its own. Netting them by game_round first is the
  // difference between a real GGR and billing 10% of gross turnover. Keyed with
  // game_uid so two games can't collide on a round id, and NULLIF falls back to
  // the reference so a payload missing either key stays its own round.
  //
  // A round is dated by its first callback, so one that straddles midnight lands
  // whole on the day it started instead of splitting across two. The offset shift
  // mirrors dayKey() so those days match the rest of the admin panel; Ethiopia
  // has no DST, so one offset for the whole range is exact.
  //
  // No ORDER BY — the day fill loop below sorts anyway, and asking Postgres for
  // sorted output made it pick a GroupAggregate that spilled a ~7 MB sort to disk
  // (the planner can't estimate group count through the date expression, so it
  // assumes one group per row). Without it the same query hash-aggregates:
  // measured 274 ms → 126 ms over 236k rows.
  const offsetMinutes = new Date().getTimezoneOffset();
  const rows = await prisma.$queryRaw<
    Array<{ day: string; staked: number; payout: number; billable: number; rounds: number }>
  >`
    WITH game_rounds AS (
      SELECT COALESCE(
               NULLIF("metadata"->>'game_uid', '') || ':' ||
               NULLIF("metadata"->>'game_round', ''),
               "reference"
             ) AS round,
             MIN("createdAt") AS started,
             SUM(COALESCE(("metadata"->>'bet_amount')::float8, 0)) AS bet,
             SUM(COALESCE(("metadata"->>'win_amount')::float8, 0)) AS win
        FROM "transactions"
       WHERE "type" IN ('BET', 'WIN')
         AND "status" = 'COMPLETED'
         AND "createdAt" >= ${from}
         AND "createdAt" <= ${to}
       GROUP BY 1
    )
    SELECT ((started - make_interval(mins => ${offsetMinutes}::int))::date)::text AS day,
           SUM(bet)::float8 AS staked,
           SUM(win)::float8 AS payout,
           SUM(GREATEST(bet - win, 0))::float8 AS billable,
           COUNT(*)::int AS rounds
      FROM game_rounds
     GROUP BY 1
  `;

  // date::text is YYYY-MM-DD in local terms already, matching dayKey()'s format.
  const byDay = new Map(rows.map((r) => [r.day, r as GgrBucket]));

  // Fill gaps between from → to so the chart has a continuous x-axis.
  const days: Array<{ date: string } & ReturnType<typeof ggrSplit>> = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= to) {
    const day = dayKey(cursor);
    days.push({
      date: day,
      ...ggrSplit(byDay.get(day) ?? { staked: 0, payout: 0, billable: 0, rounds: 0 }),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return NextResponse.json({
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    rate: SILENT_GGR_RATE,
    // Per-round, so the daily cuts below add up to exactly this.
    totals: ggrSplit(sumBuckets(rows)),
    days,
  });
}
