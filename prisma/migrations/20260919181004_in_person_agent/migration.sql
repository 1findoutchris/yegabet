-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'IN_PERSON_AGENT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "commissionRate" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "totalStake" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalWin" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "proofKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_bets" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "gameRound" TEXT,
    "betAmount" DECIMAL(12,2) NOT NULL,
    "winAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_bets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_publicId_key" ON "tickets"("publicId");

-- CreateIndex
CREATE INDEX "tickets_agentId_status_idx" ON "tickets"("agentId", "status");

-- CreateIndex
CREATE INDEX "tickets_customerPhone_idx" ON "tickets"("customerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_bets_transactionId_key" ON "ticket_bets"("transactionId");

-- CreateIndex
CREATE INDEX "ticket_bets_gameRound_idx" ON "ticket_bets"("gameRound");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_bets" ADD CONSTRAINT "ticket_bets_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_bets" ADD CONSTRAINT "ticket_bets_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

