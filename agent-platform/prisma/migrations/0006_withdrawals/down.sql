-- Manual rollback of 0006_withdrawals. DESTRUCTIVE (drops every withdrawal record):
-- written owner approval required in prod (CLAUDE.md §0). Their ledger
-- postings stay in the ledger; config rows stay (config_versions is append-only).
BEGIN;
DROP TABLE IF EXISTS "withdrawals";
DROP FUNCTION IF EXISTS withdrawals_guard();
COMMIT;
