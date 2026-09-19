-- Spendable points wallet, split out from lifetime XP. Additive.
--
-- "loyaltyPoints" stays monotonic: it drives tierForPoints(), the points-target
-- achievements and the all-time leaderboard, so decrementing it on a redemption
-- would demote players and revoke earned badges. "pointsBalance" is the counter
-- a redemption actually spends; both are incremented together by awardPoints().
ALTER TABLE "users" ADD COLUMN "pointsBalance" INTEGER NOT NULL DEFAULT 0;

-- Backfill so existing players aren't launched at zero after having already
-- earned their points. Measured at 2,120 points total across 16 users
-- (ETB 42.40 at the launch rate of 50 pts/ETB) before applying.
UPDATE "users" SET "pointsBalance" = "loyaltyPoints";
