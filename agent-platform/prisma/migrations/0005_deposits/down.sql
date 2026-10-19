-- Manual rollback of 0005_deposits. DESTRUCTIVE (drops every deposit record):
-- written owner approval required in prod (CLAUDE.md §0). Ledger postings made
-- by confirmed deposits stay in the ledger; they are history.
-- The seeded config rows stay too: config_versions is append-only.
BEGIN;
DROP TABLE IF EXISTS "deposits";
DROP TABLE IF EXISTS "agent_payment_accounts";
DROP FUNCTION IF EXISTS deposits_guard();
COMMIT;
