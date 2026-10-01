-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "copiedFromTicketId" TEXT;

-- CreateIndex
CREATE INDEX "tickets_copiedFromTicketId_idx" ON "tickets"("copiedFromTicketId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_copiedFromTicketId_fkey" FOREIGN KEY ("copiedFromTicketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

