-- UAE payment-agent (cashier) system. Additive; safe with `prisma migrate deploy`.

ALTER TABLE "deposit_requests" ADD COLUMN "processedByAgentId" TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN "processedByAgentId" TEXT;

CREATE TABLE "cashier_agents" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "currency" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashier_agents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cashier_agents_username_key" ON "cashier_agents"("username");

CREATE TABLE "agent_transactions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "refId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_transactions_agentId_type_createdAt_idx" ON "agent_transactions"("agentId", "type", "createdAt");
ALTER TABLE "agent_transactions" ADD CONSTRAINT "agent_transactions_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "cashier_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "agent_settlements" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "depositTotal" DECIMAL(12,2) NOT NULL,
    "withdrawalTotal" DECIMAL(12,2) NOT NULL,
    "commission" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_settlements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_settlements_agentId_period_key" ON "agent_settlements"("agentId", "period");
ALTER TABLE "agent_settlements" ADD CONSTRAINT "agent_settlements_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "cashier_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
