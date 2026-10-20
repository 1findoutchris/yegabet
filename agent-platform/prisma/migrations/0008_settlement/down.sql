-- Manual rollback of 0008_settlement. DESTRUCTIVE (drops every statement):
-- written owner approval required in prod (CLAUDE.md §0). Ledger postings stay;
-- config rows stay (config_versions is append-only).
BEGIN;
DROP TABLE IF EXISTS "settlement_counted";
DROP TABLE IF EXISTS "settlement_lines";
DROP TABLE IF EXISTS "settlement_periods";
DROP FUNCTION IF EXISTS settlement_lines_guard();
DROP FUNCTION IF EXISTS settlement_periods_guard();
COMMIT;
