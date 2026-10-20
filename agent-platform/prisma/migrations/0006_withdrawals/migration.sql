-- 0006_withdrawals: hold → agent pays → confirm, with SLA escalation (plan 06, CLAUDE.md §5.8).

CREATE TABLE "withdrawals" (
    "id" BIGSERIAL NOT NULL,
    "player_id" BIGINT NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "paid_reference_hash" TEXT,
    "paid_reference_enc" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "paid_by_kind" TEXT,
    "paid_by_id" TEXT,
    "hold_transaction_id" BIGINT NOT NULL,
    "final_transaction_id" BIGINT,
    "closed_by_kind" TEXT,
    "closed_by_id" TEXT,
    "close_reason" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "sla_due_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "withdrawals_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "withdrawals_method_check" CHECK ("method" IN ('telebirr', 'cbe_birr', 'ebirr')),
    CONSTRAINT "withdrawals_status_check" CHECK ("status" IN
      ('requested', 'paid', 'completed', 'cancelled', 'declined', 'escalated', 'disputed'))
);
CREATE UNIQUE INDEX "withdrawals_hold_transaction_id_key" ON "withdrawals"("hold_transaction_id");
CREATE UNIQUE INDEX "withdrawals_final_transaction_id_key" ON "withdrawals"("final_transaction_id");
-- One real payment proves one withdrawal.
CREATE UNIQUE INDEX "withdrawals_method_paid_reference_hash_key" ON "withdrawals"("method", "paid_reference_hash");
CREATE INDEX "withdrawals_agent_id_status_idx" ON "withdrawals"("agent_id", "status");
CREATE INDEX "withdrawals_player_id_created_at_idx" ON "withdrawals"("player_id", "created_at");
CREATE INDEX "withdrawals_status_sla_due_at_idx" ON "withdrawals"("status", "sla_due_at");
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_hold_transaction_id_fkey"
  FOREIGN KEY ("hold_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_final_transaction_id_fkey"
  FOREIGN KEY ("final_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only the plan's status moves; the request itself never changes; a closed
-- withdrawal has its closing ledger posting; rows are never deleted.
CREATE FUNCTION withdrawals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed TEXT[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'withdrawals are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.player_id, NEW.agent_id, NEW.method, NEW.amount, NEW.hold_transaction_id, NEW.created_at)
     IS DISTINCT FROM (OLD.player_id, OLD.agent_id, OLD.method, OLD.amount, OLD.hold_transaction_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a withdrawal request is immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  allowed := CASE OLD.status
    WHEN 'requested' THEN ARRAY['paid', 'cancelled', 'declined', 'escalated']
    WHEN 'paid'      THEN ARRAY['completed', 'disputed']
    WHEN 'escalated' THEN ARRAY['paid', 'completed', 'cancelled']
    WHEN 'disputed'  THEN ARRAY['completed', 'cancelled']
    ELSE ARRAY[]::TEXT[] END;
  IF NOT (NEW.status = ANY (allowed)) THEN
    RAISE EXCEPTION 'withdrawal % can''t go from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IN ('completed', 'cancelled', 'declined') AND NEW.final_transaction_id IS NULL THEN
    RAISE EXCEPTION 'a closed withdrawal needs its closing ledger posting' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'paid' AND NEW.paid_reference_hash IS NULL THEN
    RAISE EXCEPTION 'a paid withdrawal needs its payment reference' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER withdrawals_status_moves BEFORE UPDATE OR DELETE ON "withdrawals"
  FOR EACH ROW EXECUTE FUNCTION withdrawals_guard();

-- Owner decisions 2026-10-20 (Q-07, Q-33), as dated config. Amounts in santim.
INSERT INTO "config_versions" ("key", "value", "effective_from", "created_by") VALUES
  ('withdrawals.limits', '{"minSantim": 5000, "maxSantim": 10000000}', '2026-10-20T00:00:00Z', 'migration 0006'),
  ('withdrawals.sla_hours', '24', '2026-10-20T00:00:00Z', 'migration 0006'),
  ('withdrawals.auto_complete_hours', '24', '2026-10-20T00:00:00Z', 'migration 0006')
  ON CONFLICT DO NOTHING;
