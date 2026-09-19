-- Vegas prize wheel.
--
-- Prizes live in a table, not in reward_config JSON: `stock` must decrement
-- atomically under concurrent spins, and setRewardConfig is a whole-blob upsert
-- with a lost-update window that would hand out the same physical prize twice.

-- Spin "coupons". Earned by referring a verified signup, spent one per spin.
ALTER TABLE "users" ADD COLUMN "spinCredits" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "spin_prizes" (
    "id"        TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "cashEtb"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payoutPot" TEXT NOT NULL DEFAULT 'bonus',
    "weightBps" INTEGER NOT NULL DEFAULT 0,
    "stock"     INTEGER NOT NULL DEFAULT 0,
    "imageKey"  TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spin_prizes_pkey" PRIMARY KEY ("id"),
    -- Last line of defence below the application guards: even a buggy decrement
    -- cannot go negative, and a fat-fingered chance cannot exceed 100%.
    CONSTRAINT "spin_prizes_stock_nonneg" CHECK ("stock" >= 0),
    CONSTRAINT "spin_prizes_weight_range" CHECK ("weightBps" >= 0 AND "weightBps" <= 10000),
    CONSTRAINT "spin_prizes_cash_nonneg"  CHECK ("cashEtb" >= 0),
    CONSTRAINT "spin_prizes_kind_valid"   CHECK ("kind" IN ('CASH', 'PHYSICAL')),
    CONSTRAINT "spin_prizes_pot_valid"    CHECK ("payoutPot" IN ('bonus', 'withdrawable'))
);
CREATE INDEX "spin_prizes_isActive_sortOrder_idx" ON "spin_prizes"("isActive", "sortOrder");

CREATE TABLE "spin_credit_grants" (
    "id"         TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "refereeId"  TEXT NOT NULL,
    "credits"    INTEGER NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spin_credit_grants_pkey" PRIMARY KEY ("id")
);
-- One spin-grant per referee for all time. The anti-farm guard is a unique
-- index, not application code.
CREATE UNIQUE INDEX "spin_credit_grants_refereeId_key" ON "spin_credit_grants"("refereeId");
CREATE INDEX "spin_credit_grants_referrerId_createdAt_idx" ON "spin_credit_grants"("referrerId", "createdAt");

CREATE TABLE "spin_results" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "prizeId"   TEXT,
    "label"     TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "cashEtb"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reference" TEXT NOT NULL,
    "metadata"  JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spin_results_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "spin_results_reference_key" ON "spin_results"("reference");
CREATE INDEX "spin_results_userId_createdAt_idx" ON "spin_results"("userId", "createdAt");
CREATE INDEX "spin_results_kind_createdAt_idx" ON "spin_results"("kind", "createdAt");

-- Seed the eight launch prizes. Seeding belongs here rather than in
-- DEFAULT_REWARD_CONFIG because these rows carry mutable stock — there is no
-- "code default" to fall back to — and prisma/seed.ts is a manual script that
-- does not run on deploy.
--
-- Chances are deliberately conservative placeholders; the admin retunes them at
-- /admin/<secret>/spin, where the expected-cost readout shows what a change
-- costs per spin. Weights sum to 4110 bps (41.1%), so the remaining 58.9% is
-- the "try again" slice. The wheel ships disabled (spinWheel.enabled = false).
INSERT INTO "spin_prizes" ("id","label","kind","cashEtb","payoutPot","weightBps","stock","sortOrder","updatedAt") VALUES
 ('spinp_iphone', 'iPhone 17 Pro Max', 'PHYSICAL',      0, 'bonus',          1,      1, 0, CURRENT_TIMESTAMP),
 ('spinp_byd',    'BYD Seagull',       'PHYSICAL',      0, 'bonus',          1,      1, 1, CURRENT_TIMESTAMP),
 ('spinp_100k',   '100,000 ETB',       'CASH',     100000, 'withdrawable',   1,      1, 2, CURRENT_TIMESTAMP),
 ('spinp_10k',    '10,000 ETB',        'CASH',      10000, 'withdrawable',   2,      3, 3, CURRENT_TIMESTAMP),
 ('spinp_1k',     '1,000 ETB',         'CASH',       1000, 'bonus',          5,     50, 4, CURRENT_TIMESTAMP),
 ('spinp_500',    '500 ETB',           'CASH',        500, 'bonus',        100,    200, 5, CURRENT_TIMESTAMP),
 ('spinp_100',    '100 ETB',           'CASH',        100, 'bonus',       1000,   5000, 6, CURRENT_TIMESTAMP),
 ('spinp_50',     '50 ETB',            'CASH',         50, 'bonus',       3000, 999999, 7, CURRENT_TIMESTAMP);
