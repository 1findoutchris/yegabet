-- Payment proof for approved withdrawals (auto-expires after 2 days). Additive.
ALTER TABLE "withdrawal_requests" ADD COLUMN "proofKey" TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN "proofExpiresAt" TIMESTAMP(3);
