-- Manual rollback of 0007_providers. DESTRUCTIVE (drops every bet and provider call):
-- written owner approval required in prod (CLAUDE.md §0). Ledger postings stay.
BEGIN;
DROP TABLE IF EXISTS "games";
DROP TABLE IF EXISTS "bets";
DROP TABLE IF EXISTS "provider_calls";
DROP TABLE IF EXISTS "providers";
DROP FUNCTION IF EXISTS bets_guard();
DROP FUNCTION IF EXISTS provider_calls_guard();
COMMIT;
