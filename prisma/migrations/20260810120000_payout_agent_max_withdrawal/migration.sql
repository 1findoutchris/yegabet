-- Per-agent ceiling on a single routed withdrawal, in ETB.
-- Nullable with no default: existing agents keep no cap, which is exactly how
-- they behaved before this column existed.
ALTER TABLE "withdrawal_agents" ADD COLUMN "maxWithdrawalEtb" DECIMAL(12,2);
