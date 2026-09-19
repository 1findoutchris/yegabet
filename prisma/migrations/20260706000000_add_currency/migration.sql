-- AED presentation/settlement currency layer over the ETB base ledger.
-- All new columns are additive with defaults / nullable, so this is safe to
-- apply to a live database with `prisma migrate deploy`.

ALTER TABLE "users" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'ETB';

ALTER TABLE "withdrawal_requests" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'ETB';
ALTER TABLE "withdrawal_requests" ADD COLUMN "fxRate" DECIMAL(12,6);

ALTER TABLE "deposit_requests" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'ETB';
ALTER TABLE "deposit_requests" ADD COLUMN "fxRate" DECIMAL(12,6);
