-- Telegram chat linked to a payout agent by the bot's /login flow.
-- Additive and nullable: every existing agent keeps working without one.
ALTER TABLE "withdrawal_agents" ADD COLUMN "telegramChatId" TEXT;

CREATE UNIQUE INDEX "withdrawal_agents_telegramChatId_key"
  ON "withdrawal_agents"("telegramChatId");
