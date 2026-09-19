/*
 * Self-check for the three-pot wallet model.
 * Run: `npx tsx src/lib/wallet.check.ts`
 */
import assert from "node:assert";
import { withdrawable, debit, credit, settleRound, QUALIFYING_MULTIPLIER, type Wallet } from "./wallet";

const w = (balance: number, depositBalance: number, bonusBalance: number): Wallet =>
  ({ balance, depositBalance, bonusBalance });

/** The one rule everything else depends on: the pots must always sum to balance. */
const invariant = (x: Wallet, label: string) => {
  assert.strictEqual(
    Math.round((x.depositBalance + x.bonusBalance + withdrawable(x)) * 100) / 100,
    Math.round(x.balance * 100) / 100,
    `pots must sum to balance: ${label} → ${JSON.stringify(x)}`,
  );
  assert.ok(x.depositBalance >= 0, `deposit pot went negative: ${label}`);
  assert.ok(x.bonusBalance >= 0, `bonus pot went negative: ${label}`);
  assert.ok(x.balance >= 0, `balance went negative: ${label}`);
};

// ── withdrawable is the remainder ────────────────────────────────────────────
assert.strictEqual(withdrawable(w(180, 100, 50)), 30);
assert.strictEqual(withdrawable(w(150, 100, 50)), 0, "no winnings yet → nothing withdrawable");
assert.strictEqual(withdrawable(w(0, 0, 0)), 0);

// ── a bet drains deposit → bonus → withdrawable ──────────────────────────────
{
  // Partway into the deposit pot only.
  const r = debit(w(180, 100, 50), 60);
  assert.deepStrictEqual(r, w(120, 40, 50));
  assert.strictEqual(withdrawable(r), 30, "winnings untouched while deposit remains");
  invariant(r, "partial deposit spend");
}
{
  // Spills out of deposit into bonus (the example from the spec).
  const r = debit(w(180, 100, 50), 120);
  assert.deepStrictEqual(r, w(60, 0, 30));
  assert.strictEqual(withdrawable(r), 30, "winnings still untouched");
  invariant(r, "deposit exhausted, into bonus");
}
{
  // Spills all the way through to withdrawable.
  const r = debit(w(180, 100, 50), 170);
  assert.deepStrictEqual(r, w(10, 0, 0));
  assert.strictEqual(withdrawable(r), 10);
  invariant(r, "into withdrawable");
}
{
  // Spending everything empties every pot.
  const r = debit(w(180, 100, 50), 180);
  assert.deepStrictEqual(r, w(0, 0, 0));
  invariant(r, "full spend");
}

// ── wins land wholly in withdrawable ─────────────────────────────────────────
{
  const r = credit(w(100, 100, 0), 50, "withdrawable");
  assert.deepStrictEqual(r, w(150, 100, 0));
  assert.strictEqual(withdrawable(r), 50, "a win must be withdrawable");
  invariant(r, "win credited");
}
{
  const r = credit(w(0, 0, 0), 500, "deposit");
  assert.deepStrictEqual(r, w(500, 500, 0));
  assert.strictEqual(withdrawable(r), 0, "a fresh deposit is playable but not withdrawable");
  invariant(r, "deposit credited");
}
{
  const r = credit(w(0, 0, 0), 100, "bonus");
  assert.deepStrictEqual(r, w(100, 0, 100));
  assert.strictEqual(withdrawable(r), 0, "a fresh bonus is playable but not withdrawable");
  invariant(r, "bonus credited");
}

// ── settleRound: the provider callback's whole job ───────────────────────────
{
  // Deposit 100, stake it all, win 95 → under 110, so it goes back to deposit.
  const r = settleRound(w(100, 100, 0), 100, 95);
  assert.deepStrictEqual(r, w(95, 95, 0));
  assert.strictEqual(withdrawable(r), 0, "a losing round can't unlock the deposit");
  invariant(r, "deposit staked, paid under the bar");
}
{
  // Same stake, paid 110 → exactly on the bar, so the whole lot is cash.
  const r = settleRound(w(100, 100, 0), 100, 110);
  assert.deepStrictEqual(r, w(110, 0, 0));
  assert.strictEqual(withdrawable(r), 110, "the bar is inclusive");
  invariant(r, "deposit staked and cleared");
}
{
  // Bet and win in the same round must not refill the pot that funded the bet.
  const r = settleRound(w(100, 100, 0), 20, 22);
  assert.strictEqual(r.balance, 102);
  assert.strictEqual(r.depositBalance, 80, "the staked 20 must not return to deposit");
  assert.strictEqual(withdrawable(r), 22, "it comes back as winnings instead");
  invariant(r, "qualifying round");
}

// ── the 1.1× bar ─────────────────────────────────────────────────────────────
{
  // The spec's example: stake 10, take 11 → cash. Take 10.20 → not cash.
  const cleared = settleRound(w(100, 100, 0), 10, 11);
  assert.strictEqual(withdrawable(cleared), 11, "11 on a stake of 10 is withdrawable");
  invariant(cleared, "1.1× exactly");

  const notCleared = settleRound(w(100, 100, 0), 10, 10.2);
  assert.strictEqual(withdrawable(notCleared), 0, "10.20 on a stake of 10 is not");
  assert.strictEqual(notCleared.depositBalance, 100.2, "it returns to the deposit pot");
  invariant(notCleared, "under the bar");
}
{
  // 10 × 1.1 is 11.000000000000002 in float. The bar must not move because of it.
  assert.strictEqual(
    withdrawable(settleRound(w(100, 100, 0), 10, 10 * QUALIFYING_MULTIPLIER)),
    11,
    "float error must not push a qualifying win under the bar",
  );
}
{
  // A player's OWN cash staked on a near-1× round must come back as cash —
  // the bar must never convert withdrawable money into locked funds.
  const r = settleRound(w(100, 0, 0), 50, 51);
  assert.strictEqual(r.depositBalance, 0);
  assert.strictEqual(r.bonusBalance, 0);
  assert.strictEqual(withdrawable(r), 101, "withdrawable cash stays withdrawable");
  invariant(r, "own cash, under the bar");
}
{
  // Mixed stake: 40 deposit + 10 cash, paid 51 (under the 55 bar). The win is
  // split the way the stake was funded — 80% locked, 20% cash.
  const r = settleRound(w(100, 40, 0), 50, 51);
  assert.strictEqual(r.balance, 101);
  assert.strictEqual(r.depositBalance, 40.8, "80% of the stake was deposit money");
  assert.strictEqual(withdrawable(r), 60.2);
  invariant(r, "mixed stake under the bar");
}
{
  // Bonus is drained only after deposit, and both come back in proportion.
  const r = settleRound(w(100, 30, 70), 50, 52);
  assert.strictEqual(r.depositBalance, 31.2, "30 of the 50 came from deposit");
  assert.strictEqual(r.bonusBalance, 70.8, "and 20 from bonus");
  assert.strictEqual(withdrawable(r), 0, "a fully locked stake unlocks nothing");
  invariant(r, "bonus under the bar");
}
{
  // A partial return (win smaller than the stake) refunds deposit first and
  // never more than that pot actually funded.
  const r = settleRound(w(100, 100, 0), 10, 3);
  assert.strictEqual(r.balance, 93);
  assert.strictEqual(r.depositBalance, 93);
  assert.strictEqual(withdrawable(r), 0);
  invariant(r, "partial return");
}
{
  // A losing round takes from the pots and adds nothing.
  const r = settleRound(w(150, 100, 50), 50, 0);
  assert.deepStrictEqual(r, w(100, 50, 50));
  invariant(r, "losing round");
}
{
  // A round with no bet (pure credit) still works.
  const r = settleRound(w(10, 10, 0), 0, 40);
  assert.strictEqual(withdrawable(r), 40);
  invariant(r, "win with no stake");
}

// ── a long random walk must never break the invariant ────────────────────────
{
  let x = w(0, 0, 0);
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 3000; i++) {
    const roll = rnd();
    if (roll < 0.25) x = credit(x, Math.round(rnd() * 500), "deposit");
    else if (roll < 0.4) x = credit(x, Math.round(rnd() * 100), "bonus");
    else {
      const bet = Math.min(x.balance, Math.round(rnd() * 200));
      const win = rnd() < 0.45 ? Math.round(bet * rnd() * 3) : 0;
      x = settleRound(x, bet, win);
    }
    invariant(x, `random walk step ${i}`);
  }
}

// ── money stays at 2dp ───────────────────────────────────────────────────────
{
  const r = credit(w(0.1, 0.1, 0), 0.2, "withdrawable");
  assert.strictEqual(r.balance, 0.3, "0.1 + 0.2 must not leak float error");
  invariant(r, "rounding");
}

console.log("wallet self-check passed");
