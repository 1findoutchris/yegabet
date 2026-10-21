-- Manual rollback of 0009_game_categories (catalog display data only; no money).
DROP INDEX IF EXISTS "games_provider_slug_idx";
DROP INDEX IF EXISTS "games_active_section_category_idx";
ALTER TABLE "games" DROP COLUMN IF EXISTS "first_seen_at";
ALTER TABLE "games" DROP COLUMN IF EXISTS "provider_slug";
ALTER TABLE "games" DROP COLUMN IF EXISTS "category";
ALTER TABLE "games" DROP COLUMN IF EXISTS "section";
