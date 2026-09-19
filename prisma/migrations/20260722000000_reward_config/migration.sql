-- Admin-editable reward configuration (one row per block). Additive.
CREATE TABLE "reward_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_config_pkey" PRIMARY KEY ("key")
);
