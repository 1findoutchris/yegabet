-- Replace the two wagering counters with three explicit pots.
--
-- Before: `balance` was cash, `bonusBalance` sat OUTSIDE it as locked credit
-- that released only once `wagerRequired` hit zero. Two invisible counters, both
-- confusing to players.
--
-- After: `balance` is total playable funds and contains everything. Two of its
-- three pots are tracked; the third is derived:
--   withdrawable = balance − depositBalance − bonusBalance
--
-- Players gain their previously-locked bonus as immediately playable funds, and
-- nobody loses withdrawable value.

-- No earlier migration creates `bonusBalance` — it existed only because the
-- database was originally built with `prisma db push` rather than by replaying
-- migrations. IF NOT EXISTS so the chain works on a fresh database and stays a
-- no-op on a pushed one.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bonusBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "users" ADD COLUMN "depositBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Fold the old out-of-band bonus into the single playable balance. New rows
-- default to 0, so this only ever mattered for pre-existing players.
UPDATE "users" SET "balance" = "balance" + "bonusBalance";

ALTER TABLE "users" DROP COLUMN "wagerRequired";
