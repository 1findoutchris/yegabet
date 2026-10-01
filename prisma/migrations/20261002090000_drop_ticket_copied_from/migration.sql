-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_copiedFromTicketId_fkey";

-- DropIndex
DROP INDEX "tickets_copiedFromTicketId_idx";

-- AlterTable
ALTER TABLE "tickets" DROP COLUMN "copiedFromTicketId";

