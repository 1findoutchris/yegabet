-- Telegram account linked to a player by the VinnaBet bot (contact share).
-- Additive and nullable: every existing account keeps working without one.
ALTER TABLE "users" ADD COLUMN "telegramUserId" TEXT,
ADD COLUMN "telegramUsername" TEXT,
ADD COLUMN "telegramFirstName" TEXT,
ADD COLUMN "telegramLinkedAt" TIMESTAMP(3),
ADD COLUMN "telegramPhoneVerifiedAt" TIMESTAMP(3);

-- One Telegram account → at most one VinnaBet account.
CREATE UNIQUE INDEX "users_telegramUserId_key" ON "users"("telegramUserId");
