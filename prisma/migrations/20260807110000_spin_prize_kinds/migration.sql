-- Two more prize kinds on the wheel.
--
-- SPIN — the prize is more coupons ("win a free spin"), credited to
--        users.spinCredits rather than to a wallet pot.
-- NONE — an explicit "try again" wedge with its own configurable chance.
--        Previously a loss was only the implicit remainder below 100%, which
--        had no wedge, so the pointer stopped on a real prize while the result
--        said "No win". A NONE row gives the loss somewhere to land.
--
-- The implicit remainder still exists as a fallback when the weights don't
-- reach 100%; explicit NONE rows just make it visible and tunable.

ALTER TABLE "spin_prizes" ADD COLUMN "creditsAwarded" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "spin_prizes" DROP CONSTRAINT "spin_prizes_kind_valid";
ALTER TABLE "spin_prizes" ADD CONSTRAINT "spin_prizes_kind_valid"
  CHECK ("kind" IN ('CASH', 'PHYSICAL', 'SPIN', 'NONE'));

ALTER TABLE "spin_prizes" ADD CONSTRAINT "spin_prizes_credits_nonneg"
  CHECK ("creditsAwarded" >= 0);

-- Seed a try-again wedge carrying the whole of the previously-implicit losing
-- remainder (10000 − 4110 = 5890 bps), so the wheel's odds are unchanged but a
-- loss now lands on a wedge. Stock is nominal — the spin route treats NONE as
-- always available.
INSERT INTO "spin_prizes" ("id","label","kind","cashEtb","payoutPot","weightBps","stock","sortOrder","updatedAt") VALUES
 ('spinp_tryagain', 'Try again', 'NONE', 0, 'bonus', 5890, 999999, 8, CURRENT_TIMESTAMP);
