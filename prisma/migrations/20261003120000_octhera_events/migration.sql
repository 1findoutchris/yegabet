-- CreateTable
CREATE TABLE "octhera_events" (
    "id" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "betAmount" DECIMAL(12,2) NOT NULL,
    "winAmount" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2),
    "balance" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "gameRound" TEXT,
    "gameUid" TEXT,
    "gameName" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "octhera_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "octhera_events_username_createdAt_idx" ON "octhera_events"("username", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "octhera_events_txnId_action_key" ON "octhera_events"("txnId", "action");

