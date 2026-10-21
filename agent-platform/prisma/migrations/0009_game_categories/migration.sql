-- 0009_game_categories: where each game sits in the lobby (plan 12).
-- Existing rows are classified by the next catalog import (hourly, and at boot).
ALTER TABLE "games" ADD COLUMN "section" TEXT NOT NULL DEFAULT 'games';
ALTER TABLE "games" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "games" ADD COLUMN "provider_slug" TEXT;
ALTER TABLE "games" ADD COLUMN "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "games_active_section_category_idx" ON "games"("active", "section", "category");
CREATE INDEX "games_provider_slug_idx" ON "games"("provider_slug");
