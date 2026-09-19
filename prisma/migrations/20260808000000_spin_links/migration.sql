-- Admin-generated "rigged" prize-wheel links.
--
-- Single-use: the first signup through a link claims it, and that user is then
-- guaranteed the assigned prize on their spin. One link = one winner.
--
-- There is deliberately no users.guaranteedPrizeId column. This row has to
-- exist anyway (the admin lists, copies and deletes links), so a second copy of
-- the same fact would just be two places to disagree — and disagreeing here
-- means a doubled or a silently lost prize. It also buys no race safety: a user
-- column would need the identical compare-and-set, just somewhere worse.

CREATE TABLE "spin_links" (
    "id"              TEXT NOT NULL,
    "code"            TEXT NOT NULL,
    "prizeId"         TEXT NOT NULL,
    "prizeLabel"      TEXT NOT NULL,
    "note"            TEXT,
    "claimedByUserId" TEXT,
    "claimedAt"       TIMESTAMP(3),
    "fulfilledRef"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spin_links_pkey" PRIMARY KEY ("id"),
    -- Claimed and fulfilled are ordered states; fulfilling an unclaimed link is
    -- a bug, so the database refuses it outright.
    CONSTRAINT "spin_links_fulfilled_implies_claimed"
      CHECK ("fulfilledRef" IS NULL OR "claimedByUserId" IS NOT NULL)
);

CREATE UNIQUE INDEX "spin_links_code_key" ON "spin_links"("code");

-- At most ONE pending guarantee per user, enforced by the database rather than
-- by application code — same reasoning as spin_credit_grants_refereeId_key.
-- This is what turns "the spin route's compare-and-set matches at most one row"
-- from an assumption into a guarantee. Unclaimed rows have claimedByUserId NULL
-- and are all distinct under a unique index, so they never collide.
CREATE UNIQUE INDEX "spin_links_pending_user_key"
  ON "spin_links"("claimedByUserId") WHERE "fulfilledRef" IS NULL;

CREATE INDEX "spin_links_claimedByUserId_idx" ON "spin_links"("claimedByUserId");
