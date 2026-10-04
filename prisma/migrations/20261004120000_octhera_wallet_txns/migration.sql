-- CreateTable
CREATE TABLE "octhera_wallet_txns" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "action" TEXT,
    "betAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "winAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "applied" BOOLEAN NOT NULL,
    "response" JSONB NOT NULL,
    "gameUid" TEXT,
    "gameRound" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "octhera_wallet_txns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "octhera_wallet_txns_type_txnId_key" ON "octhera_wallet_txns"("type", "txnId");

-- CreateIndex
CREATE INDEX "octhera_wallet_txns_playerId_createdAt_idx" ON "octhera_wallet_txns"("playerId", "createdAt");
