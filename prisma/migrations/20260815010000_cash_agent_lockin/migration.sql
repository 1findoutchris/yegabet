-- Which cash agent a player last deposited with.
--
-- Deliberately NOT a foreign key. The column is a routing preference, not a
-- relationship: a deactivated or deleted agent must degrade to "no preference"
-- rather than block the row, and an FK would turn agent cleanup into a cascade
-- decision over player records.
ALTER TABLE "users" ADD COLUMN "cashAgentId" TEXT;

-- Cash withdrawals look up "is this player locked to an agent" on every
-- request; partial index because the column is NULL for everyone who has never
-- used a counter.
CREATE INDEX "users_cashAgentId_idx" ON "users" ("cashAgentId") WHERE "cashAgentId" IS NOT NULL;
