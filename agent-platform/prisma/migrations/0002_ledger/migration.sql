-- 0002_ledger: double-entry, append-only ledger (plan 02, CLAUDE.md §5.1).

CREATE TABLE "accounts" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "owner_kind" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'ETB',
    "allow_negative" BOOLEAN NOT NULL,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "accounts_type_check" CHECK ("type" IN (
      'PLAYER_WALLET', 'PLAYER_HELD', 'AGENT_CASH_POSITION', 'AGENT_PAYABLE', 'PARENT_PAYABLE',
      'COMPANY_FLOAT', 'COMPANY_REVENUE', 'PROVIDER_PAYABLE', 'PROVIDER_FEES')),
    CONSTRAINT "accounts_owner_kind_check" CHECK ("owner_kind" IN ('player', 'agent', 'company', 'provider'))
);
CREATE UNIQUE INDEX "accounts_type_owner_kind_owner_id_currency_key"
  ON "accounts"("type", "owner_kind", "owner_id", "currency");

CREATE TABLE "account_balances" (
    "account_id" BIGINT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_balances_pkey" PRIMARY KEY ("account_id")
);

CREATE TABLE "ledger_transactions" (
    "id" BIGSERIAL NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reference_id" TEXT,
    "reverses_transaction_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key_key" ON "ledger_transactions"("idempotency_key");
CREATE UNIQUE INDEX "ledger_transactions_reverses_transaction_id_key" ON "ledger_transactions"("reverses_transaction_id");

CREATE TABLE "ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "transaction_id" BIGINT NOT NULL,
    "debit_account_id" BIGINT NOT NULL,
    "credit_account_id" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "reference_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "ledger_entries_distinct_accounts" CHECK ("debit_account_id" <> "credit_account_id")
);
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");
CREATE INDEX "ledger_entries_debit_account_id_idx" ON "ledger_entries"("debit_account_id");
CREATE INDEX "ledger_entries_credit_account_id_idx" ON "ledger_entries"("credit_account_id");

ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reverses_transaction_id_fkey"
  FOREIGN KEY ("reverses_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_debit_account_id_fkey"
  FOREIGN KEY ("debit_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_credit_account_id_fkey"
  FOREIGN KEY ("credit_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- History can't be edited or deleted, by the app or by a manual SQL session.
CREATE TRIGGER ledger_transactions_immutable
  BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_transactions_no_truncate
  BEFORE TRUNCATE ON "ledger_transactions"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- The balance cache may only change inside a ledger posting, which runs
-- SET LOCAL ledger.posting = 'on' for its own transaction.
CREATE FUNCTION guard_account_balances() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('ledger.posting', true), '') <> 'on' THEN
    RAISE EXCEPTION 'account_balances can only change through a ledger posting'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER account_balances_guard
  BEFORE UPDATE OR DELETE ON "account_balances"
  FOR EACH ROW EXECUTE FUNCTION guard_account_balances();
