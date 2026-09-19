-- Cash agents: the counter-service rail.
--
-- Only a flag is added. The float itself needs no column — it is the sum of the
-- agent's TOPUP / FLOAT_RETURN / CASH_DEPOSIT / CASH_PAYOUT rows in the existing
-- withdrawal_agent_txns table, the same way `outstanding` is already derived
-- from PAYOUT / COMMISSION / SETTLEMENT.
ALTER TABLE "withdrawal_agents"
  ADD COLUMN "isCashAgent" BOOLEAN NOT NULL DEFAULT false;

-- The float sum scans one agent's ledger rows by type; the existing index is
-- (agentId, type, createdAt), which already covers it. No new index needed.
