-- Manual rollback of 0002_ledger. DESTRUCTIVE (drops all money history):
-- written owner approval required in prod (CLAUDE.md §0).
DROP TABLE IF EXISTS "ledger_entries";
DROP TABLE IF EXISTS "ledger_transactions";
DROP TABLE IF EXISTS "account_balances";
DROP TABLE IF EXISTS "accounts";
DROP FUNCTION IF EXISTS guard_account_balances();
