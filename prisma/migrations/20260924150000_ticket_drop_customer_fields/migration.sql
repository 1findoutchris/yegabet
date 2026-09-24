-- Tickets go anonymous: no customer name/phone collected or stored.
-- The publicId code is the only customer-facing identifier.
DROP INDEX "tickets_customerPhone_idx";
ALTER TABLE "tickets" DROP COLUMN "customerName";
ALTER TABLE "tickets" DROP COLUMN "customerPhone";
