-- Four tables the Prisma schema has always expected but no migration ever
-- created: they exist in the live database only because it was built with
-- `prisma db push` instead of by replaying migrations.
--
-- The gap was invisible until the chain was replayed from scratch, which failed
-- at 20260807100000_payment_method_toggles with 42P01 "relation payment_agents
-- does not exist". Backdated to sit before every migration that touches them.
--
-- IF NOT EXISTS throughout, because these are exactly the objects `db push`
-- already created: on a pushed database this is a no-op, on a fresh one it is
-- the real definition.

-- Secret-URL admin auth (env-var credentials + a Redis session; see adminAuth.ts).
CREATE TABLE IF NOT EXISTS "admin_users" (
    "id"           TEXT NOT NULL,
    "username"     TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "admin_users_username_key" ON "admin_users"("username");

-- Audit trail for every privileged action (logAdminAction).
CREATE TABLE IF NOT EXISTS "admin_logs" (
    "id"         TEXT NOT NULL,
    "action"     TEXT NOT NULL,
    "targetId"   TEXT,
    "targetType" TEXT,
    "note"       TEXT,
    "ipAddress"  TEXT,
    "metadata"   JSONB,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "admin_logs_action_idx"   ON "admin_logs"("action");
CREATE INDEX IF NOT EXISTS "admin_logs_targetId_idx" ON "admin_logs"("targetId");

-- Admin-editable destination account per payment method. `id` is the method id
-- (telebirr | cbebirr | ebirr | uae_bank), not a cuid. The per-direction kill
-- switches are added by 20260807100000_payment_method_toggles.
CREATE TABLE IF NOT EXISTS "payment_agents" (
    "id"          TEXT NOT NULL,
    "agentNumber" TEXT NOT NULL,
    "agentName"   TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_agents_pkey" PRIMARY KEY ("id")
);

-- Web Push endpoints — one row per device, so a player can be reached on
-- several phones. Cascades so deleting a user cleans up their subscriptions.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "endpoint"  TEXT NOT NULL,
    "p256dh"    TEXT NOT NULL,
    "auth"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

DO $$
BEGIN
  ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL; -- already present on a pushed database
END $$;
