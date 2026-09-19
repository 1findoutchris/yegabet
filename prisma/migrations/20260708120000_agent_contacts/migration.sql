-- Per-agent contact (WhatsApp/Telegram) + the agent a customer chose to withdraw with. Additive.
ALTER TABLE "cashier_agents" ADD COLUMN "contactType" TEXT;
ALTER TABLE "cashier_agents" ADD COLUMN "contactHandle" TEXT;
ALTER TABLE "withdrawal_requests" ADD COLUMN "agentId" TEXT;
