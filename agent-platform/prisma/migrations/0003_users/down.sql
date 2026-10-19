-- Manual rollback of 0003_users. DESTRUCTIVE: written owner approval required in prod (CLAUDE.md §0).
-- Removes the seeded company/agent ledger accounts, which is only allowed
-- while they have no entries: the FK from ledger_entries refuses otherwise.
-- One transaction, so a refusal leaves everything as it was.
BEGIN;
SET LOCAL ledger.posting = 'on';
DELETE FROM "account_balances" WHERE account_id IN (
  SELECT id FROM "accounts" WHERE owner_kind IN ('company', 'agent', 'player'));
DELETE FROM "accounts" WHERE owner_kind IN ('company', 'agent', 'player');
DROP TABLE IF EXISTS "agent_members";
DROP TABLE IF EXISTS "staff_roles";
DROP TABLE IF EXISTS "roles";
DROP TABLE IF EXISTS "staff";
DROP TABLE IF EXISTS "agent_assignments";
DROP TABLE IF EXISTS "players";
DROP TABLE IF EXISTS "agents";
DROP FUNCTION IF EXISTS agents_set_path();
DROP FUNCTION IF EXISTS agents_guard();
DROP FUNCTION IF EXISTS agent_assignments_guard();
COMMIT;
