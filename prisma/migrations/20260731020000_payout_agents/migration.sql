-- Payout agents: settle player withdrawals on the automatic (ETB) rail.
-- They hold no float — the platform records what it owes them plus commission
-- and settles later — so there is no balance column here.
CREATE TABLE "withdrawal_agents" (
    "id"             TEXT NOT NULL,
    "username"       TEXT NOT NULL,
    "passwordHash"   TEXT NOT NULL,
    "name"           TEXT,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "methods"        TEXT[],
    "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "slaMinutes"     INTEGER NOT NULL DEFAULT 30,
    "contactType"    TEXT,
    "contactHandle"  TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawal_agents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "withdrawal_agents_username_key" ON "withdrawal_agents"("username");

-- Outstanding owed + commission earned. No running balance: the amount due is
-- the sum of PAYOUT + COMMISSION rows since the last SETTLEMENT.
CREATE TABLE "withdrawal_agent_txns" (
    "id"        TEXT NOT NULL,
    "agentId"   TEXT NOT NULL,
    "type"      TEXT NOT NULL,
    "amount"    DECIMAL(12,2) NOT NULL,
    "refId"     TEXT,
    "note"      TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_agent_txns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "withdrawal_agent_txns_agentId_type_createdAt_idx"
    ON "withdrawal_agent_txns"("agentId", "type", "createdAt");
ALTER TABLE "withdrawal_agent_txns"
    ADD CONSTRAINT "withdrawal_agent_txns_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "withdrawal_agents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Withdrawal requests: routing, the SLA clock, the cancel lock, and a short
-- quotable id.
ALTER TABLE "withdrawal_requests" ADD COLUMN "publicId"          TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN "txnReference"      TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN "withdrawalAgentId" TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN "assignedAt"        TIMESTAMP(3);
ALTER TABLE "withdrawal_requests" ADD COLUMN "processingAt"      TIMESTAMP(3);
ALTER TABLE "withdrawal_requests" ADD COLUMN "paidAt"            TIMESTAMP(3);

-- Backfill a stable code for existing rows so every request is quotable.
-- Derived from the row id, so it is deterministic and collision-free in
-- practice at 16^6 across this table's size; new rows are generated in app
-- code with a uniqueness retry.
UPDATE "withdrawal_requests"
   SET "publicId" = 'W-' || UPPER(SUBSTRING(MD5("id") FROM 1 FOR 6))
 WHERE "publicId" IS NULL;

CREATE UNIQUE INDEX "withdrawal_requests_publicId_key" ON "withdrawal_requests"("publicId");
CREATE INDEX "withdrawal_requests_withdrawalAgentId_status_idx"
    ON "withdrawal_requests"("withdrawalAgentId", "status");
ALTER TABLE "withdrawal_requests"
    ADD CONSTRAINT "withdrawal_requests_withdrawalAgentId_fkey"
    FOREIGN KEY ("withdrawalAgentId") REFERENCES "withdrawal_agents"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
