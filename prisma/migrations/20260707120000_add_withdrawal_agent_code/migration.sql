-- UAE withdrawal handshake: a short code the customer gives the agent. Additive.
ALTER TABLE "withdrawal_requests" ADD COLUMN "agentCode" TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN "codeExpiresAt" TIMESTAMP(3);
CREATE INDEX "withdrawal_requests_agentCode_idx" ON "withdrawal_requests"("agentCode");
