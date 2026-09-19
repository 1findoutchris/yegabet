/*
 * Self-check for the prize-wheel draw and wedge geometry — the logic that
 * decides who wins an iPhone, so it gets the hard cases.
 * Run: `npx tsx src/lib/spin.check.ts`
 */
import assert from "node:assert";
import { drawPrize, resolveSpin, segmentAngle, wrapLabel, FULL_BPS, type SpinSegment } from "./spinCore";

const seg = (id: string, weightBps: number, stock: number): SpinSegment => ({ id, weightBps, stock });

/** Every ticket value in [0, denom) exactly once — no sampling, no flake. */
function sweep(segments: SpinSegment[], steps = FULL_BPS) {
  const hits = new Map<string, number>();
  let nulls = 0;
  for (let i = 0; i < steps; i++) {
    const out = drawPrize(segments, i / steps);
    if (out.prizeId === null) nulls++;
    else hits.set(out.prizeId, (hits.get(out.prizeId) ?? 0) + 1);
  }
  return { hits, nulls };
}

// ── Determinism ───────────────────────────────────────────────────────────────
const dSegs = [seg("a", 3000, 5), seg("b", 3000, 5)];
for (let i = 0; i < 50; i++) {
  const roll = i / 50;
  assert.deepStrictEqual(drawPrize(dSegs, roll), drawPrize(dSegs, roll), "same roll → same outcome");
}

// ── Stock gates the prize regardless of chance ────────────────────────────────
// The whole point of the stock limit: a 100% prize with no stock never lands.
for (let i = 0; i < 1000; i++) {
  assert.deepStrictEqual(drawPrize([seg("a", FULL_BPS, 0)], i / 1000), { prizeId: null, index: -1 });
}

// Zero chance is unwinnable even with stock on the shelf.
for (let i = 0; i < 1000; i++) {
  assert.strictEqual(drawPrize([seg("a", 0, 99)], i / 1000).prizeId, null);
}

// All stock gone → nothing winnable.
assert.strictEqual(drawPrize([seg("a", 5000, 0), seg("b", 5000, 0)], 0.1).prizeId, null);

// Empty wheel.
assert.deepStrictEqual(drawPrize([], 0.5), { prizeId: null, index: -1 });

// Garbage rolls must not throw or escape the walk.
assert.strictEqual(drawPrize([seg("a", FULL_BPS, 1)], 1).prizeId, "a", "roll of exactly 1 stays in range");
assert.strictEqual(drawPrize([seg("a", FULL_BPS, 1)], NaN).prizeId, "a");
assert.strictEqual(drawPrize([seg("a", FULL_BPS, 1)], -5).prizeId, "a");

// ── Index is against the ORIGINAL array ───────────────────────────────────────
// The bug the eligibility filter invites: if an ineligible segment is dropped
// before indexing, the wheel visually lands on the wrong prize.
const skewed = [seg("dead", 0, 9), seg("live", FULL_BPS, 9)];
assert.strictEqual(drawPrize(skewed, 0.5).index, 1, "index must count the ineligible segment");

// Only "live" is eligible at 5000 bps, so just half this wheel is winnable —
// roll inside that half, and confirm the other half is genuinely a loss.
const skewed2 = [seg("empty", 5000, 0), seg("empty2", 5000, 0), seg("live", 5000, 3)];
assert.strictEqual(drawPrize(skewed2, 0.25).index, 2);
assert.strictEqual(drawPrize(skewed2, 0.75).index, -1, "out-of-stock weight is not redistributed");

// ── Weights summing UNDER 100% → a real try-again slice ───────────────────────
const under = [seg("a", 1000, 9), seg("b", 1000, 9)]; // 10% + 10%
assert.strictEqual(drawPrize(under, 0.00).prizeId, "a");
assert.strictEqual(drawPrize(under, 0.05).prizeId, "a");
assert.strictEqual(drawPrize(under, 0.15).prizeId, "b");
assert.strictEqual(drawPrize(under, 0.50).prizeId, null, "the shortfall really is a losing slice");

const underSweep = sweep(under);
assert.strictEqual(underSweep.hits.get("a"), 1000);
assert.strictEqual(underSweep.hits.get("b"), 1000);
assert.strictEqual(underSweep.nulls, 8000, "80% of the wheel is try-again");

// ── Weights summing OVER 100% (admin typo) → normalise, never truncate ────────
const over = [seg("a", 5000, 9), seg("b", 5000, 9), seg("c", 5000, 9)]; // 150%
const overSweep = sweep(over, 9999);
assert.strictEqual(overSweep.nulls, 0, "no try-again slice when weights exceed 100%");
for (const id of ["a", "b", "c"]) {
  const n = overSweep.hits.get(id) ?? 0;
  assert.ok(Math.abs(n - 3333) <= 2, `${id} normalised to ~1/3, got ${n}`);
}
// The last prize must be reachable — an off-by-one here silently orphans it.
assert.strictEqual(drawPrize(over, 0.99999).prizeId, "c");

// ── Weights summing EXACTLY 100% → full coverage, no losses ───────────────────
const exact = [seg("a", 2500, 9), seg("b", 2500, 9), seg("c", 5000, 9)];
const exactSweep = sweep(exact);
assert.strictEqual(exactSweep.nulls, 0);
assert.strictEqual(exactSweep.hits.get("a"), 2500);
assert.strictEqual(exactSweep.hits.get("b"), 2500);
assert.strictEqual(exactSweep.hits.get("c"), 5000);

// ── Boundary: a 1-bps prize must own exactly its one ticket ───────────────────
const tiny = [seg("rare", 1, 1), seg("common", 9999, 9)];
assert.strictEqual(drawPrize(tiny, 0).prizeId, "rare", "the first ticket is not skipped");
assert.strictEqual(drawPrize(tiny, 0.0001).prizeId, "common");
const tinySweep = sweep(tiny);
assert.strictEqual(tinySweep.hits.get("rare"), 1, "1 bps = exactly 1 in 10000");

// ── segmentAngle ──────────────────────────────────────────────────────────────
assert.strictEqual(segmentAngle(8, 0), 337.5); // wedge 0 centres at 22.5°, rotate back
assert.strictEqual(segmentAngle(4, 0), 315);
assert.strictEqual(segmentAngle(1, 0), 180);

const angles = Array.from({ length: 8 }, (_, i) => segmentAngle(8, i));
assert.strictEqual(new Set(angles).size, 8, "every wedge gets a distinct angle");
for (const a of angles) assert.ok(a >= 0 && a < 360, `angle ${a} out of range`);

// Consecutive wedges are exactly one wedge-width apart (mod 360).
for (let i = 0; i < 7; i++) {
  const delta = ((segmentAngle(8, i) - segmentAngle(8, i + 1)) % 360 + 360) % 360;
  assert.strictEqual(delta, 45);
}

// Degenerate counts must not produce NaN.
assert.strictEqual(segmentAngle(0, 0), 0);

// ── resolveSpin (rigged promo links) ─────────────────────────────────────────
// A guaranteed prize must win regardless of chance or stock, and an id that is
// no longer on the wheel must degrade to a fair draw rather than a silent loss.

// 1. No guarantee → byte-identical to drawPrize. The regression guard on the
//    path ~every spin takes.
const fair = [seg("a", 2000, 5), seg("b", 3000, 5), seg("c", 1000, 0)];
for (let i = 0; i < FULL_BPS; i++) {
  const roll = i / FULL_BPS;
  assert.deepStrictEqual(
    resolveSpin(fair, roll),
    { ...drawPrize(fair, roll), guaranteed: false },
    `resolveSpin diverged from drawPrize at roll ${roll}`,
  );
}

// 2. Guaranteed at zero stock wins every roll — drawPrize alone can never
//    return it, so this is the behaviour change the links depend on.
const oos = [seg("cheap", 5000, 99), seg("iphone", 1, 0)];
for (let i = 0; i < 1000; i++) {
  const out = resolveSpin(oos, i / 1000, "iphone");
  assert.strictEqual(out.prizeId, "iphone");
  assert.strictEqual(out.index, 1);
  assert.strictEqual(out.guaranteed, true);
}

// 3. Guaranteed at zero chance wins too — a display-only prize can still be
//    handed out deliberately via a link.
const zeroChance = [seg("cheap", 5000, 99), seg("byd", 0, 1)];
for (let i = 0; i < 1000; i++) {
  assert.strictEqual(resolveSpin(zeroChance, i / 1000, "byd").prizeId, "byd");
}

// 4. Guaranteed id not on the wheel → fair draw, and guaranteed:false so the
//    caller leaves the link unconsumed instead of burning it.
for (let i = 0; i < 1000; i++) {
  const roll = i / 1000;
  const out = resolveSpin(fair, roll, "deleted-prize");
  assert.deepStrictEqual(out, { ...drawPrize(fair, roll), guaranteed: false });
}

// 5. Index counts the ORIGINAL array, including ineligible segments before the
//    guaranteed one. This is the assertion that catches a wrong wedge on screen.
const padded = [seg("dead", 0, 9), seg("empty", 5000, 0), seg("target", 1, 1)];
assert.strictEqual(resolveSpin(padded, 0.5, "target").index, 2);

// 6. A guarantee pointing at a try-again wedge returns its index rather than
//    throwing. The admin route rejects this, but a prize's kind can be edited
//    after the link was issued.
const withNone = [seg("cash", 5000, 5), seg("tryagain", 5000, 999)];
assert.strictEqual(resolveSpin(withNone, 0.1, "tryagain").index, 1);

// 7. The override precedes normalisation entirely — it wins even on a wheel
//    whose weights already fill 100%.
const full = [seg("a", 9999, 9), seg("rare", 1, 1)];
for (let i = 0; i < 1000; i++) {
  assert.strictEqual(resolveSpin(full, i / 1000, "rare").prizeId, "rare");
}

// ── wrapLabel ─────────────────────────────────────────────────────────────────
// The invariant that matters: no returned line may exceed the wedge width, or
// the label renders outside its wedge. Everything else is presentation.
const wrapCases: [string, number, number][] = [
  ["iPhone 17 Pro Max", 12, 2],
  ["100,000 ETB", 12, 2],
  ["BYD Seagull", 12, 2],
  ["50 ETB", 12, 2],
  ["Supercalifragilisticexpialidocious", 12, 2],
  ["A B C D E F G H I J K L M N", 8, 2],
  ["", 12, 2],
  ["   ", 12, 2],
  ["one-really-long-hyphenated-token here", 10, 3],
];
for (const [label, width, lines] of wrapCases) {
  const out = wrapLabel(label, width, lines);
  assert.ok(out.length <= lines, `"${label}" produced ${out.length} lines, max ${lines}`);
  for (const ln of out) {
    assert.ok(ln.length <= width, `line "${ln}" is ${ln.length} chars, max ${width}`);
  }
}

// Short labels stay on one line, untouched.
assert.deepStrictEqual(wrapLabel("50 ETB", 12, 2), ["50 ETB"]);
assert.deepStrictEqual(wrapLabel("100,000 ETB", 12, 2), ["100,000 ETB"]);

// A label that doesn't fit one line is split at a space, not mid-word.
assert.deepStrictEqual(wrapLabel("iPhone 17 Pro Max", 12, 2), ["iPhone 17", "Pro Max"]);

// Blank input yields nothing to render, rather than [""].
assert.deepStrictEqual(wrapLabel("", 12, 2), []);
assert.deepStrictEqual(wrapLabel("   ", 12, 2), []);

// A single unbreakable word is hard-split — greedy wrap alone would let it
// overflow the wedge.
const longWord = wrapLabel("Supercalifragilisticexpialidocious", 12, 2);
assert.strictEqual(longWord.length, 2);
assert.ok(longWord[1].endsWith("…"), "an over-long word must show it was cut");

// Overflow past maxLines is signalled, never silently dropped.
const clipped = wrapLabel("one two three four five six seven", 8, 2);
assert.strictEqual(clipped.length, 2);
assert.ok(clipped[1].endsWith("…"));

// Degenerate widths must not loop forever or throw.
assert.ok(wrapLabel("hello world", 1, 2).every((l) => l.length <= 1));
assert.ok(wrapLabel("hello world", 0, 0).length >= 1, "clamps to at least one line");

console.log("spin self-check passed");
