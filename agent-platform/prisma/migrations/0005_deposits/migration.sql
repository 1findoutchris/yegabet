-- 0005_deposits: agent payment accounts and manually confirmed deposits (plan 05, CLAUDE.md §5.7).

CREATE TABLE "agent_payment_accounts" (
    "id" BIGSERIAL NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_payment_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_payment_accounts_method_check" CHECK ("method" IN ('telebirr', 'cbe_birr', 'ebirr'))
);
CREATE UNIQUE INDEX "agent_payment_accounts_method_account_number_key"
  ON "agent_payment_accounts"("method", "account_number");
CREATE INDEX "agent_payment_accounts_agent_id_idx" ON "agent_payment_accounts"("agent_id");
ALTER TABLE "agent_payment_accounts" ADD CONSTRAINT "agent_payment_accounts_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "deposits" (
    "id" BIGSERIAL NOT NULL,
    "player_id" BIGINT NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "payment_account_id" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "reference_hash" TEXT NOT NULL,
    "reference_enc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by_kind" TEXT,
    "decided_by_id" TEXT,
    "decision_reason" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "ledger_transaction_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deposits_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "deposits_method_check" CHECK ("method" IN ('telebirr', 'cbe_birr', 'ebirr')),
    CONSTRAINT "deposits_status_check" CHECK ("status" IN ('pending', 'confirmed', 'rejected', 'expired'))
);
-- §5.7: a reference can be used once, ever, even after a rejection.
CREATE UNIQUE INDEX "deposits_method_reference_hash_key" ON "deposits"("method", "reference_hash");
-- One ledger posting per deposit.
CREATE UNIQUE INDEX "deposits_ledger_transaction_id_key" ON "deposits"("ledger_transaction_id");
CREATE INDEX "deposits_agent_id_status_idx" ON "deposits"("agent_id", "status");
CREATE INDEX "deposits_player_id_created_at_idx" ON "deposits"("player_id", "created_at");
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_payment_account_id_fkey"
  FOREIGN KEY ("payment_account_id") REFERENCES "agent_payment_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_ledger_transaction_id_fkey"
  FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A deposit is decided once: pending → confirmed | rejected | expired, and the
-- request itself (who, how much, which reference) never changes. Never deleted.
CREATE FUNCTION deposits_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deposits are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'deposit % is already %', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'pending' THEN
    RAISE EXCEPTION 'a pending deposit can only change by being decided' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.player_id, NEW.agent_id, NEW.payment_account_id, NEW.method, NEW.amount,
      NEW.reference_hash, NEW.reference_enc, NEW.created_at)
     IS DISTINCT FROM (OLD.player_id, OLD.agent_id, OLD.payment_account_id, OLD.method, OLD.amount,
      OLD.reference_hash, OLD.reference_enc, OLD.created_at) THEN
    RAISE EXCEPTION 'a deposit request is immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status = 'confirmed' AND NEW.ledger_transaction_id IS NULL THEN
    RAISE EXCEPTION 'a confirmed deposit needs its ledger transaction' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER deposits_decide_once BEFORE UPDATE OR DELETE ON "deposits"
  FOR EACH ROW EXECUTE FUNCTION deposits_guard();

-- Owner decisions 2026-10-19 (Q-27, Q-30), as dated config so a later change
-- never rewrites history. Amounts in santim.
INSERT INTO "config_versions" ("key", "value", "effective_from", "created_by") VALUES
  ('deposits.limits', '{"minSantim": 1500, "maxSantim": 10000000}', '2026-10-19T00:00:00Z', 'migration 0005'),
  ('deposits.pending_ttl_hours', '24', '2026-10-19T00:00:00Z', 'migration 0005')
  ON CONFLICT DO NOTHING;
