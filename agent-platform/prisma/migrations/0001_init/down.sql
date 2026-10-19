-- Manual rollback of 0001_init. DESTRUCTIVE: written owner approval required in prod (CLAUDE.md §0).
DROP TABLE IF EXISTS "feature_flags";
DROP TABLE IF EXISTS "config_versions";
DROP FUNCTION IF EXISTS forbid_mutation();
