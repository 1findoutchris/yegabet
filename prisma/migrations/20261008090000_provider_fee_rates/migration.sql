-- Provider GGR fee agreements, append-only (see ProviderFeeRate).
CREATE TABLE "provider_fee_rates" (
    "id" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "ratePct" DECIMAL(5,2) NOT NULL,
    "negativePolicy" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "changedBy" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_fee_rates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_fee_rates_providerKey_effectiveFrom_idx" ON "provider_fee_rates"("providerKey", "effectiveFrom");

-- Carry over the agreement the Silent GGR page already applied: Silent API
-- charges 10% of each round the house wins (verified against their export).
-- Effective from the start, so historical Silent periods read as before.
INSERT INTO "provider_fee_rates" ("id", "providerKey", "ratePct", "negativePolicy", "effectiveFrom", "changedBy", "note")
VALUES ('seed_silent_default', 'silent:*', 10.00, 'per_round', DATE '2000-01-01', 'migration',
        'Carried over from the Silent GGR page: 10% of each house-won round, never netted.');
