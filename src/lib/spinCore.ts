// Pure prize-wheel maths: the draw and the wedge geometry. No `server-only`, no
// prisma, no Decimal — so it runs under plain node in spin.check.ts and can also
// be imported by the client wheel (same split as rewardConfigCore / adsCore).

/** Chance is in basis points: 10000 bps = 100%. Integer, so the cumulative-sum
 *  walk is exact and cannot drift across a long prize list. */
export const FULL_BPS = 10000;

export interface SpinSegment {
  id: string;
  weightBps: number;
  stock: number;
}

export interface SpinOutcome {
  prizeId: string | null;
  /** Index into the ORIGINAL segments array — the wedge to land on. -1 = no win. */
  index: number;
}

export const NO_WIN: SpinOutcome = { prizeId: null, index: -1 };

/**
 * Pick a prize.
 *
 * @param roll  a number in [0, 1), injected rather than generated so the draw is
 *              deterministic under test.
 *
 * Two admin-misconfiguration cases are handled rather than thrown on, because a
 * live wheel must keep working:
 *   - weights summing UNDER 100% — the shortfall is a real "try again" slice.
 *   - weights summing OVER 100% (a typo) — weights normalise proportionally and
 *     there is no try-again slice.
 *
 * A segment is eligible only with `weightBps > 0 && stock > 0`, but the returned
 * `index` counts against the original array so the wedge the server picks is the
 * wedge the client rendered.
 */
export function drawPrize(segments: SpinSegment[], roll: number): SpinOutcome {
  // A caller passing exactly 1 (or NaN) must not fall off the end of the walk.
  const r = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 0.999999999) : 0;

  let total = 0;
  for (const s of segments) {
    if (s.weightBps > 0 && s.stock > 0) total += s.weightBps;
  }
  if (total === 0) return NO_WIN;

  const denom = Math.max(total, FULL_BPS);
  const ticket = Math.floor(r * denom);

  let cumulative = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.weightBps <= 0 || s.stock <= 0) continue;
    cumulative += s.weightBps;
    if (ticket < cumulative) return { prizeId: s.id, index: i };
  }

  // Only reachable when total < FULL_BPS — the try-again slice.
  return NO_WIN;
}

/**
 * `drawPrize` with an admin-guaranteed override, for rigged promo links.
 *
 * A guaranteed prize wins regardless of chance OR stock — that is the whole
 * point of the link, and the caller is responsible for honouring "award even at
 * zero stock" without letting stock go negative.
 *
 * A `guaranteedPrizeId` that isn't on the wheel (prize deactivated or deleted
 * since the link was issued) falls back to a fair draw and reports
 * `guaranteed: false`, so the caller knows to leave the link unconsumed rather
 * than burning a promise it couldn't keep.
 */
export function resolveSpin(
  segments: SpinSegment[],
  roll: number,
  guaranteedPrizeId?: string,
): SpinOutcome & { guaranteed: boolean } {
  if (guaranteedPrizeId) {
    const index = segments.findIndex((s) => s.id === guaranteedPrizeId);
    if (index >= 0) return { prizeId: guaranteedPrizeId, index, guaranteed: true };
  }
  return { ...drawPrize(segments, roll), guaranteed: false };
}

/**
 * Break a prize label into lines that fit a wedge. SVG `<text>` does not wrap,
 * so the wheel renders one `<tspan>` per returned line.
 *
 * Greedy word wrap, with two cases that would otherwise overflow silently:
 *   - a single word longer than a whole line is hard-split rather than left to
 *     spill past the wedge edge;
 *   - anything still over `maxLines` is dropped and the last kept line gets an
 *     ellipsis, so the label is visibly cut rather than quietly missing words.
 *
 * Returns [] for a blank label.
 */
export function wrapLabel(label: string, maxChars: number, maxLines: number): string[] {
  const width = Math.max(1, Math.floor(maxChars));
  const limit = Math.max(1, Math.floor(maxLines));
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let cur = "";
  const flush = () => { if (cur) { lines.push(cur); cur = ""; } };

  for (const original of words) {
    let word = original;
    while (word.length > width) {
      flush();
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;

    const candidate = cur ? `${cur} ${word}` : word;
    if (candidate.length <= width) {
      cur = candidate;
    } else {
      flush();
      cur = word;
    }
  }
  flush();

  if (lines.length <= limit) return lines;

  const kept = lines.slice(0, limit);
  const last = kept[limit - 1];
  // The ellipsis is spent out of the width budget, not added on top of it —
  // otherwise a narrow wedge ends up one character over.
  kept[limit - 1] = last.length >= width
    ? `${last.slice(0, width - 1).trimEnd()}…`
    : `${last}…`;
  return kept;
}

/**
 * Degrees the wheel must rotate so wedge `index` of `count` sits under the
 * 12-o'clock pointer. Wedge i spans [i·360/n, (i+1)·360/n) clockwise from the
 * top, so its centre is at (i + 0.5)·360/n and the wheel turns back by that.
 * Result is in [0, 360).
 */
export function segmentAngle(count: number, index: number): number {
  if (count <= 0) return 0;
  const centre = ((index + 0.5) * 360) / count;
  return ((360 - centre) % 360 + 360) % 360;
}
