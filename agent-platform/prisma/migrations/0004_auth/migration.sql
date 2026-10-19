-- 0004_auth: Telegram sign-up and login, sessions, audit log (plan 04).

-- Sessions: the token is 32 random bytes handed to the client; only its
-- sha256 is stored, so a database leak can't be replayed as logins.
CREATE TABLE "sessions" (
    "id" BIGSERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "principal_kind" TEXT NOT NULL,
    "principal_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "ip" TEXT,
    "user_agent" TEXT,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_principal_kind_check" CHECK ("principal_kind" IN ('player', 'agent_member', 'staff'))
);
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_principal_idx" ON "sessions"("principal_kind", "principal_id");

-- Between /start in the bot and the contact share (30 min).
CREATE TABLE "signup_intents" (
    "telegram_user_id" TEXT NOT NULL,
    "referral_slug" TEXT,
    "web_code_hash" TEXT,
    "age_confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "signup_intents_pkey" PRIMARY KEY ("telegram_user_id")
);

-- Website sign-up hand-off: the site gets a one-time code, the bot finishes
-- the sign-up, and the site exchanges the code for one session (15 min).
CREATE TABLE "web_signups" (
    "code_hash" TEXT NOT NULL,
    "referral_slug" TEXT,
    "player_id" BIGINT,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "web_signups_pkey" PRIMARY KEY ("code_hash")
);
ALTER TABLE "web_signups" ADD CONSTRAINT "web_signups_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- §3: append-only audit log of every sensitive action (who, what, when, before/after, IP).
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_kind" TEXT,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- §3 age hook: when the player confirmed they are 18+ (minimum age is config, Q-08).
ALTER TABLE "players" ADD COLUMN "age_confirmed_at" TIMESTAMPTZ(6);
