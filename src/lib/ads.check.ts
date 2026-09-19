/*
 * Self-check for the ad popup/expiry logic.
 * Run: `npx tsx src/lib/ads.check.ts`
 */
import assert from "node:assert";
import { parseExpiry, pickUnseenAd, nearestIndex } from "./adsCore";

// An ad expiring "today" is still live for the whole of that day.
const exp = parseExpiry("2026-08-06");
assert.ok(exp > new Date("2026-08-06T12:00:00.000Z"), "still live mid-day");
assert.ok(exp < new Date("2026-08-07T00:00:00.000Z"), "dead the next day");
assert.ok(isNaN(parseExpiry("not-a-date").getTime()), "garbage date is rejectable");

const ads = [{ id: "a" }, { id: "b" }];

// Nothing dismissed → newest ad shows.
assert.deepStrictEqual(pickUnseenAd(ads, null, "2026-08-06"), { id: "a" });

// Dismissed today → falls through to the next ad, not a re-show of the same one.
assert.deepStrictEqual(pickUnseenAd(ads, "a:2026-08-06", "2026-08-06"), { id: "b" });

// Same dismissal, next day → the ad comes back.
assert.deepStrictEqual(pickUnseenAd(ads, "a:2026-08-05", "2026-08-06"), { id: "a" });

// Only ad, dismissed today → nothing shows.
assert.strictEqual(pickUnseenAd([{ id: "a" }], "a:2026-08-06", "2026-08-06"), null);

// Carousel index. Slide pitch here is 300 (280 wide + 20 gap) — deliberately
// not a round multiple of any container width, since assuming pitch ==
// clientWidth is the bug this replaced.
const offsets = [0, 300, 600];
assert.strictEqual(nearestIndex(offsets, 0), 0);
assert.strictEqual(nearestIndex(offsets, 300), 1);
assert.strictEqual(nearestIndex(offsets, 600), 2);

// Mid-swipe: snaps to whichever slide is closer, and ties keep the earlier one.
assert.strictEqual(nearestIndex(offsets, 140), 0);
assert.strictEqual(nearestIndex(offsets, 160), 1);
assert.strictEqual(nearestIndex(offsets, 150), 0);

// Rubber-band overscroll past either end must stay in range.
assert.strictEqual(nearestIndex(offsets, -80), 0);
assert.strictEqual(nearestIndex(offsets, 9999), 2);

// Single slide (dots hidden, but the math still runs on scroll).
assert.strictEqual(nearestIndex([0], 37), 0);

console.log("ads self-check passed");
