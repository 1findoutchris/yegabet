/*
 * Self-check for the homepage promotion rules: link validation, visibility
 * (dates, completeness) and how a slot's promotions are laid out.
 * Run: `npx tsx src/lib/homePromoCore.check.ts`
 */
import assert from "node:assert";
import { hiddenReason, imageProblem, slotRows, validDestination, type PromoRecord } from "./homePromoCore";

// ── destinations ──
for (const ok of ["/deposit", "/games?tab=crash", "/casino/slots#top", "/rewards/bonuses"]) {
  assert.ok(validDestination("internal", ok), ok);
}
for (const bad of ["", "deposit", "//evil.com", "/\\evil.com", "/a b", "javascript:alert(1)", "https://x.com", "/" + "a".repeat(500)]) {
  assert.ok(!validDestination("internal", bad), bad);
}
assert.ok(validDestination("external", "https://t.me/vinnabet"));
for (const bad of ["http://x.com", "javascript:alert(1)", "https://", "ftp://x.com", "/deposit", "https://x .com"]) {
  assert.ok(!validDestination("external", bad), bad);
}

// ── visibility ──
const now = new Date("2026-10-08T12:00:00Z");
const base: PromoRecord = {
  id: "p", title: "t", heading: null, description: null, hasImage: true, hasMobileImage: false,
  imageAlt: "Weekend offer", ctaLabel: null, destType: "internal", destUrl: "/deposit",
  layout: "banner", slot: "middle", sortOrder: 0, isActive: true, startsAt: null, endsAt: null,
};
const r = (o: Partial<PromoRecord>) => hiddenReason({ ...base, ...o }, now);
assert.equal(r({}), null);
assert.equal(r({ isActive: false }), "Switched off");
assert.equal(r({ startsAt: new Date("2026-10-09T00:00:00Z") }), "Not started yet");
assert.equal(r({ endsAt: now }), "Ended");
assert.equal(r({ startsAt: new Date("2026-10-01"), endsAt: new Date("2026-10-30") }), null);
assert.equal(r({ slot: "top" }), "Invalid placement");
assert.equal(r({ layout: "popup" }), "Invalid placement");
assert.equal(r({ hasImage: false }), "Needs an image or a heading");
assert.equal(r({ hasImage: false, heading: "  " }), "Needs an image or a heading");
assert.equal(r({ hasImage: false, heading: "Deposit bonus", imageAlt: null }), null);
assert.equal(r({ imageAlt: " " }), "Image needs alternative text");
assert.equal(r({ destUrl: null }), "Needs a valid destination");
assert.equal(r({ destUrl: "//evil.com" }), "Needs a valid destination");
assert.equal(r({ destType: "external", destUrl: "http://x.com" }), "Needs a valid destination");

// ── layout ──
const L = (s: string) => s.split("").map((c, i) => ({ id: `${c}${i}`, layout: c === "b" ? "banner" : "poster" }));
const shape = (s: string) => slotRows(L(s)).map((x) => (x.kind === "banner" ? "B" : `P${x.promos.length}`)).join(",");
assert.equal(shape(""), "");
assert.equal(shape("pp"), "P2");
assert.equal(shape("p"), "P1");
assert.equal(shape("ppp"), "P2,P1");
assert.equal(shape("bpp"), "B,P2");
assert.equal(shape("pbp"), "P1,B,P1");
assert.equal(shape("bb"), "B,B");

// ── uploads ──
assert.equal(imageProblem({ type: "image/webp", size: 1000 }), null);
assert.ok(imageProblem({ type: "image/svg+xml", size: 1000 }));
assert.ok(imageProblem({ type: "image/png", size: 0 }));
assert.ok(imageProblem({ type: "image/png", size: 4 * 1024 * 1024 + 1 }));

console.log("homePromoCore: ok");
