-- Manual rollback of 0004_auth. DESTRUCTIVE (drops the audit log and all sessions):
-- written owner approval required in prod (CLAUDE.md §0).
BEGIN;
ALTER TABLE "players" DROP COLUMN IF EXISTS "age_confirmed_at";
DROP TABLE IF EXISTS "audit_log";
DROP TABLE IF EXISTS "web_signups";
DROP TABLE IF EXISTS "signup_intents";
DROP TABLE IF EXISTS "sessions";
COMMIT;
