-- Agent-initiated settlement requests. The SETTLEMENT ledger row that actually
-- clears the debt is written when an admin marks one PAID, not here.
CREATE TABLE "agent_payout_requests" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_payout_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_payout_requests_status_createdAt_idx" ON "agent_payout_requests"("status", "createdAt");
CREATE INDEX "agent_payout_requests_agentId_createdAt_idx" ON "agent_payout_requests"("agentId", "createdAt");

ALTER TABLE "agent_payout_requests"
  ADD CONSTRAINT "agent_payout_requests_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "withdrawal_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
