-- 0007_providers: seamless-wallet providers, their calls, bets with the agent
-- snapshot, and the game catalog (plan 07, CLAUDE.md §5.6).

CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);
INSERT INTO "providers" ("id", "name") VALUES ('octhera', 'Octhera') ON CONFLICT DO NOTHING;

-- Every wallet call, once per (provider, type, txn_id): the provider's own
-- idempotency key. `response` is exactly what we answered and is replayed on
-- any retry. The only allowed change is a refused credit becoming applied
-- when a retry finds its round backed.
CREATE TABLE "provider_calls" (
    "id" BIGSERIAL NOT NULL,
    "provider_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "txn_id" TEXT NOT NULL,
    "player_id" BIGINT,
    "action" TEXT,
    "game_uid" TEXT,
    "game_round" TEXT,
    "bet_amount" BIGINT NOT NULL DEFAULT 0,
    "win_amount" BIGINT NOT NULL DEFAULT 0,
    "applied" BOOLEAN NOT NULL,
    "response" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "ledger_transaction_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_calls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "provider_calls_type_check" CHECK ("type" IN ('debit', 'credit', 'rollback'))
);
CREATE UNIQUE INDEX "provider_calls_provider_id_type_txn_id_key" ON "provider_calls"("provider_id", "type", "txn_id");
CREATE INDEX "provider_calls_round_idx" ON "provider_calls"("provider_id", "player_id", "game_round");
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_ledger_transaction_id_fkey"
  FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION provider_calls_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider_calls rows are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (OLD.type = 'credit' AND NOT OLD.applied)
     OR (NEW.provider_id, NEW.type, NEW.txn_id, NEW.player_id, NEW.created_at)
        IS DISTINCT FROM (OLD.provider_id, OLD.type, OLD.txn_id, OLD.player_id, OLD.created_at) THEN
    RAISE EXCEPTION 'provider_calls rows are immutable (only a refused credit may be re-checked)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_calls_immutable BEFORE UPDATE OR DELETE ON "provider_calls"
  FOR EACH ROW EXECUTE FUNCTION provider_calls_guard();

-- §5.6: each bet with the agent who owned the player when it was placed.
CREATE TABLE "bets" (
    "id" BIGSERIAL NOT NULL,
    "provider_id" TEXT NOT NULL,
    "player_id" BIGINT NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "game_uid" TEXT,
    "game_round" TEXT,
    "debit_txn_id" TEXT NOT NULL,
    "stake" BIGINT NOT NULL,
    "win" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "placed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMPTZ(6),
    CONSTRAINT "bets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bets_amounts_check" CHECK ("stake" >= 0 AND "win" >= 0),
    CONSTRAINT "bets_status_check" CHECK ("status" IN ('open', 'settled', 'rolled_back'))
);
CREATE UNIQUE INDEX "bets_provider_id_debit_txn_id_key" ON "bets"("provider_id", "debit_txn_id");
CREATE INDEX "bets_player_id_status_idx" ON "bets"("player_id", "status");
CREATE INDEX "bets_agent_settlement_idx" ON "bets"("agent_id", "provider_id", "settled_at");
CREATE INDEX "bets_round_idx" ON "bets"("provider_id", "player_id", "game_round");
CREATE INDEX "bets_status_placed_at_idx" ON "bets"("status", "placed_at");
ALTER TABLE "bets" ADD CONSTRAINT "bets_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bets" ADD CONSTRAINT "bets_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bets" ADD CONSTRAINT "bets_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Who, how much and which agent never change; a bet only moves forward
-- (open → settled → rolled_back, or open → rolled_back) and its win only grows.
CREATE FUNCTION bets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bets are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.provider_id, NEW.player_id, NEW.agent_id, NEW.game_round, NEW.debit_txn_id, NEW.stake, NEW.placed_at)
     IS DISTINCT FROM (OLD.provider_id, OLD.player_id, OLD.agent_id, OLD.game_round, OLD.debit_txn_id, OLD.stake, OLD.placed_at) THEN
    RAISE EXCEPTION 'a bet''s player, agent and stake are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'rolled_back'
     OR (OLD.status = 'settled' AND NEW.status = 'open')
     OR NEW.win < OLD.win THEN
    RAISE EXCEPTION 'bet % can''t go from % to % (win % → %)', OLD.id, OLD.status, NEW.status, OLD.win, NEW.win
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bets_forward_only BEFORE UPDATE OR DELETE ON "bets"
  FOR EACH ROW EXECUTE FUNCTION bets_guard();

CREATE TABLE "games" (
    "provider_id" TEXT NOT NULL,
    "game_uid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider_name" TEXT,
    "type" TEXT,
    "img" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "games_pkey" PRIMARY KEY ("provider_id", "game_uid")
);
CREATE INDEX "games_active_type_idx" ON "games"("active", "type");
ALTER TABLE "games" ADD CONSTRAINT "games_provider_id_fkey"
  FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Q-35 (owner, 2026-10-20): a bet with no credit 24 h after it was placed is settled as lost.
INSERT INTO "config_versions" ("key", "value", "effective_from", "created_by") VALUES
  ('bets.auto_settle_hours', '24', '2026-10-20T00:00:00Z', 'migration 0007')
  ON CONFLICT DO NOTHING;
