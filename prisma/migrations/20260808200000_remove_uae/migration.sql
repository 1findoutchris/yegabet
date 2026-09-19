-- Remove the UAE / AED rail. The platform is Ethiopia-only and single-currency.
--
-- Gone with it: the cashier-agent cash desk (a float-holding operator who
-- settled AED deposits and withdrawals in person), the per-user display
-- currency, and the FX columns that were always 1 because there was never any
-- conversion — AED was a 1:1 relabel of the ETB ledger.
--
-- Kept: withdrawal_agents / withdrawal_agent_txns. Those are the PAYOUT agents
-- on the automatic ETB rail, which is a different system that happens to share
-- the word "agent".

-- Cashier-agent cash desk. Child tables first — both carry a foreign key to
-- cashier_agents, so dropping the parent first would fail.
DROP TABLE IF EXISTS "agent_settlements";
DROP TABLE IF EXISTS "agent_transactions";
DROP TABLE IF EXISTS "cashier_agents";

-- Per-user display currency. Every balance is ETB.
ALTER TABLE "users" DROP COLUMN IF EXISTS "currency";

-- The UAE withdrawal handshake: the customer picked a cashier agent, got a
-- 4-char code, and handed it over in person to be paid in cash.
DROP INDEX IF EXISTS "withdrawal_requests_agentCode_idx";
ALTER TABLE "withdrawal_requests" DROP COLUMN IF EXISTS "agentId";
ALTER TABLE "withdrawal_requests" DROP COLUMN IF EXISTS "agentCode";
ALTER TABLE "withdrawal_requests" DROP COLUMN IF EXISTS "codeExpiresAt";
ALTER TABLE "withdrawal_requests" DROP COLUMN IF EXISTS "processedByAgentId";
ALTER TABLE "withdrawal_requests" DROP COLUMN IF EXISTS "currency";
ALTER TABLE "withdrawal_requests" DROP COLUMN IF EXISTS "fxRate";

ALTER TABLE "deposit_requests" DROP COLUMN IF EXISTS "processedByAgentId";
ALTER TABLE "deposit_requests" DROP COLUMN IF EXISTS "currency";
ALTER TABLE "deposit_requests" DROP COLUMN IF EXISTS "fxRate";

-- The UAE bank transfer method shown on the old agent deposit form.
DELETE FROM "payment_agents" WHERE "id" = 'uae_bank';
