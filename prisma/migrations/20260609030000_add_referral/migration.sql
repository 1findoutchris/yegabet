-- Add referral columns to users
ALTER TABLE "users" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "users" ADD COLUMN "referredById" TEXT;

-- Unique index on referralCode for fast lookup at signup
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- Self-referencing FK (nullable — existing users and users without a referrer)
ALTER TABLE "users" ADD CONSTRAINT "users_referredById_fkey"
    FOREIGN KEY ("referredById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
