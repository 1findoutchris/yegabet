-- Editable ads with admin-controlled carousel order.
--
-- `sortOrder` was the documented upgrade path when ads shipped: ordering was
-- newest-first, to be revisited once more than a couple of board ads ran at
-- once. Default 0 across the board means every existing ad ties, and the
-- createdAt tiebreak reproduces exactly the old behaviour.
ALTER TABLE "ads" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- `updatedAt` exists to cache-bust the image. The S3 key is fixed per ad
-- (`ads/<id>`), so replacing a banner overwrites in place — and the public
-- image route sends `Cache-Control: max-age=86400`. Without a changing query
-- string, a swapped banner would keep serving the old bytes for a day.
-- DEFAULT backfills existing rows; Prisma manages the column from here.
ALTER TABLE "ads" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
