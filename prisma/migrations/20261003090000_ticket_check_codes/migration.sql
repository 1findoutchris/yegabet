-- CreateTable
CREATE TABLE "ticket_check_codes" (
    "code" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_check_codes_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_check_codes_transactionId_key" ON "ticket_check_codes"("transactionId");

-- AddForeignKey
ALTER TABLE "ticket_check_codes" ADD CONSTRAINT "ticket_check_codes_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

