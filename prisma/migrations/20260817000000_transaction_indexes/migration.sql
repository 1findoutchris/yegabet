-- `transactions` had only transactions_pkey and transactions_reference_key, so
-- every query that filters by type/status/createdAt or by userId seq-scanned the
-- whole table (236k rows and growing): the admin GGR + reports + stats pages, and
-- the per-player challenge / cashback / achievement / leaderboard / my-casino
-- reads that run on ordinary page loads.

-- Reporting: type + status narrow first, createdAt is the range scanned.
CREATE INDEX "transactions_type_status_createdAt_idx"
    ON "transactions" ("type", "status", "createdAt");

-- Per-player history and the per-type sums those routes take.
CREATE INDEX "transactions_userId_type_idx"
    ON "transactions" ("userId", "type");

-- NOTE: plain CREATE INDEX takes ACCESS EXCLUSIVE on the table for the build
-- (sub-second at 236k rows, but it does block bets while it runs). To build with
-- no write lock, skip this migration and run the two statements by hand with
-- CREATE INDEX CONCURRENTLY instead — Prisma wraps a migration in a transaction
-- and CONCURRENTLY cannot run inside one, then mark it applied with
-- `prisma migrate resolve --applied 20260817000000_transaction_indexes`.
