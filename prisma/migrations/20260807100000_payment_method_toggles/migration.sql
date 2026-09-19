-- Per-method enable/disable for deposits and withdrawals.
--
-- Two flags rather than one: an operator commonly has a rail down in a single
-- direction (agent float exhausted, provider outage on cash-in only), and one
-- shared flag would force both off together.
--
-- Defaults are true, and a method with no payment_agents row at all is treated
-- as enabled (see getMergedMethods) — so this migration turns nothing off.
-- IF NOT EXISTS because `payment_agents` predates the migration chain (it was
-- created by `db push`), so a pushed database may already carry these.
ALTER TABLE "payment_agents" ADD COLUMN IF NOT EXISTS "depositEnabled"  BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "payment_agents" ADD COLUMN IF NOT EXISTS "withdrawEnabled" BOOLEAN NOT NULL DEFAULT true;
