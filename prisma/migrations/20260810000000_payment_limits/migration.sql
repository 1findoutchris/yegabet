-- Per-method deposit/withdrawal amount limits, admin-editable.
--
-- These replace the constants that lived in the deposit and withdraw routes
-- (MIN 50 / MAX 100_000, and withdrawals had no ceiling at all). The defaults
-- below reproduce the old behaviour exactly, so this migration changes nothing
-- until an admin edits a method.
--
-- Whole ETB, not Decimal: a limit is a threshold an operator types, not money
-- that has to reconcile to the cent.
--
-- IF NOT EXISTS for the same reason as the toggles migration — `payment_agents`
-- predates the migration chain, so a pushed database may already carry these.
ALTER TABLE "payment_agents" ADD COLUMN IF NOT EXISTS "minDeposit"  INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "payment_agents" ADD COLUMN IF NOT EXISTS "maxDeposit"  INTEGER NOT NULL DEFAULT 100000;
ALTER TABLE "payment_agents" ADD COLUMN IF NOT EXISTS "minWithdraw" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "payment_agents" ADD COLUMN IF NOT EXISTS "maxWithdraw" INTEGER NOT NULL DEFAULT 100000;
