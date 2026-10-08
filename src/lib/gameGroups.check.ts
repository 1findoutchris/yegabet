/*
 * Self-check for the lobby game groups: the provider's type decides first,
 * the name only when the type is generic.
 * Run: `npx tsx src/lib/gameGroups.check.ts`
 */
import assert from "node:assert";
import { FAST_GROUPS, LIVE_GROUPS, groupOf, splitByGroup } from "./gameGroups";

const g = (gameNameEn: string, type?: string) => ({ gameNameEn, type });

// Live: a generic "Casino Live" type → the name decides.
assert.equal(groupOf(g("Lightning Roulette", "Casino Live"), LIVE_GROUPS), "roulette");
assert.equal(groupOf(g("Speed Blackjack A", "Casino Live"), LIVE_GROUPS), "blackjack");
assert.equal(groupOf(g("Crazy Time", "Casino Live"), LIVE_GROUPS), "gameshow");
assert.equal(groupOf(g("Unnamed Table 3", "Casino Live"), LIVE_GROUPS), null);
// A specific provider type wins over the name.
assert.equal(groupOf(g("Golden Wealth Baccarat Roulette Edition", "Live Baccarat"), LIVE_GROUPS), "baccarat");

// Fast games: type first.
assert.equal(groupOf(g("Space XY", "Crash"), FAST_GROUPS), "crash");
assert.equal(groupOf(g("Rocket Dice", "Dice"), FAST_GROUPS), "dice");
assert.equal(groupOf(g("Goal", "Instant"), FAST_GROUPS), "instant");
assert.equal(groupOf(g("Mines", "Instant"), FAST_GROUPS), "instant"); // provider said instant
assert.equal(groupOf(g("Mines", "Mini games"), FAST_GROUPS), "instant");
assert.equal(groupOf(g("Mines", "Casino"), FAST_GROUPS), "mines");   // generic type → name
assert.equal(groupOf(g("Aviator"), FAST_GROUPS), "crash");
assert.equal(groupOf(g("Plinko X", "Plinko"), FAST_GROUPS), "plinko");

// Split keeps group order and drops empty groups.
const split = splitByGroup([g("Mines", "Mines"), g("Aviator", "Crash"), g("JetX", "Crash")], FAST_GROUPS);
assert.deepEqual(split.map((s) => [s.id, s.games.length]), [["crash", 2], ["mines", 1]]);

console.log("gameGroups: ok");
