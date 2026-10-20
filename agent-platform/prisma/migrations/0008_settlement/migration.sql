-- 0008_settlement: 10-day periods, statement lines, per-bet counted amounts (plan 10, CLAUDE.md §5.10).

CREATE TABLE "settlement_periods" (
    "id" BIGSERIAL NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "config" JSONB,                       -- the rules used (dated config versions in force at ends_at)
    "drafted_at" TIMESTAMPTZ(6),
    "approved_by_kind" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "settlement_periods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settlement_periods_status_check" CHECK ("status" IN ('open', 'draft', 'approved')),
    CONSTRAINT "settlement_periods_order" CHECK ("ends_at" > "starts_at")
);
CREATE UNIQUE INDEX "settlement_periods_starts_at_key" ON "settlement_periods"("starts_at");

-- An approved period is frozen; otherwise it only moves forward.
CREATE FUNCTION settlement_periods_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'approved' THEN
    RAISE EXCEPTION 'an approved settlement period is frozen' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.starts_at, NEW.ends_at) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at)
     OR (OLD.status = 'draft' AND NEW.status = 'open') THEN
    RAISE EXCEPTION 'a settlement period''s dates are fixed and its status only moves forward'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_periods_forward BEFORE UPDATE OR DELETE ON "settlement_periods"
  FOR EACH ROW EXECUTE FUNCTION settlement_periods_guard();

CREATE TABLE "settlement_lines" (
    "id" BIGSERIAL NOT NULL,
    "period_id" BIGINT NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "stakes" BIGINT NOT NULL,
    "winnings" BIGINT NOT NULL,
    "fees" BIGINT NOT NULL,
    "result" BIGINT NOT NULL,             -- G = stakes - winnings - fees (may be negative)
    "beneficiary" TEXT NOT NULL,
    "beneficiary_agent_id" BIGINT,
    "parent_level" INTEGER,
    "amount" BIGINT NOT NULL,             -- the agent line carries G itself when G <= 0
    "ledger_transaction_id" BIGINT,
    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settlement_lines_beneficiary_check" CHECK ("beneficiary" IN ('agent', 'company', 'provider', 'parent')),
    CONSTRAINT "settlement_lines_amount_check" CHECK ("beneficiary" = 'agent' OR "amount" >= 0)
);
CREATE INDEX "settlement_lines_period_agent_idx" ON "settlement_lines"("period_id", "agent_id");
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_period_id_fkey"
  FOREIGN KEY ("period_id") REFERENCES "settlement_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_ledger_transaction_id_fkey"
  FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lines can be replaced while their period is a draft; frozen once it is approved.
CREATE FUNCTION settlement_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s TEXT;
BEGIN
  SELECT status INTO s FROM settlement_periods WHERE id = COALESCE(OLD.period_id, NEW.period_id);
  IF s = 'approved' THEN
    RAISE EXCEPTION 'lines of an approved settlement period are frozen' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_lines_frozen BEFORE INSERT OR UPDATE OR DELETE ON "settlement_lines"
  FOR EACH ROW EXECUTE FUNCTION settlement_lines_guard();

-- What each bet has contributed to approved periods so far. A bet counted once
-- never counts twice; a later rollback or late win shows up as the difference.
CREATE TABLE "settlement_counted" (
    "bet_id" BIGINT NOT NULL,
    "stake" BIGINT NOT NULL,
    "win" BIGINT NOT NULL,
    "period_id" BIGINT NOT NULL,
    CONSTRAINT "settlement_counted_pkey" PRIMARY KEY ("bet_id")
);
ALTER TABLE "settlement_counted" ADD CONSTRAINT "settlement_counted_bet_id_fkey"
  FOREIGN KEY ("bet_id") REFERENCES "bets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlement_counted" ADD CONSTRAINT "settlement_counted_period_id_fkey"
  FOREIGN KEY ("period_id") REFERENCES "settlement_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Owner decisions 2026-10-20 as dated config. The owner can change any of them
-- later through POST /admin/config; a change applies from its date onwards and
-- never rewrites an approved period. Percentages are basis points (1% = 100).
-- settlement.first_period_start is set on launch day (no default: no settlement before launch).
INSERT INTO "config_versions" ("key", "value", "effective_from", "created_by") VALUES
  ('commission.split', '{"agentBp": 6000, "companyBp": 1000, "providerBp": 1000, "parentsBp": [1000, 500, 500]}', '2026-10-20T00:00:00Z', 'migration 0008'),
  ('settlement.max_parent_levels', '3', '2026-10-20T00:00:00Z', 'migration 0008'),
  ('settlement.period_days', '10', '2026-10-20T00:00:00Z', 'migration 0008'),
  ('settlement.rounding_unit_santim', '100', '2026-10-20T00:00:00Z', 'migration 0008'),
  ('settlement.payment_fees', '{"mode": "none"}', '2026-10-20T00:00:00Z', 'migration 0008')
  ON CONFLICT DO NOTHING;
