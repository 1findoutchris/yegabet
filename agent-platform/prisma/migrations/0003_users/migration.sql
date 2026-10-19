-- 0003_users: players, agents (immutable parent + ancestor path), assignment
-- history, staff and roles, plus the company agent seed (plan 03, CLAUDE.md §5.2).

CREATE TABLE "agents" (
    "id" BIGSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "parent_id" BIGINT,
    "ancestors" BIGINT[] NOT NULL DEFAULT '{}',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "is_company" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agents_slug_format" CHECK ("slug" ~ '^[a-z0-9-]{3,40}$'),
    CONSTRAINT "agents_status_check" CHECK ("status" IN ('active', 'paused', 'closed')),
    CONSTRAINT "agents_company_is_root" CHECK (NOT "is_company" OR "parent_id" IS NULL),
    CONSTRAINT "agents_depth_matches_path" CHECK ("depth" = cardinality("ancestors"))
);
CREATE UNIQUE INDEX "agents_slug_key" ON "agents"("slug");
CREATE UNIQUE INDEX "agents_one_company" ON "agents"("is_company") WHERE "is_company";
CREATE INDEX "agents_parent_id_idx" ON "agents"("parent_id");
CREATE INDEX "agents_ancestors_idx" ON "agents" USING GIN ("ancestors");
ALTER TABLE "agents" ADD CONSTRAINT "agents_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The ancestor path is computed by the database from the parent, never taken
-- from the app. A parent must exist, be active, and not be the company agent
-- (top-level agents are parentless; their parent shares go to the company).
CREATE FUNCTION agents_set_path() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p RECORD;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.ancestors := '{}';
  ELSE
    SELECT ancestors, status, is_company INTO p FROM agents WHERE id = NEW.parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'parent agent % does not exist', NEW.parent_id USING ERRCODE = 'check_violation';
    END IF;
    IF p.is_company THEN
      RAISE EXCEPTION 'the company agent cannot be a parent' USING ERRCODE = 'check_violation';
    END IF;
    IF p.status <> 'active' THEN
      RAISE EXCEPTION 'parent agent % is not active', NEW.parent_id USING ERRCODE = 'check_violation';
    END IF;
    NEW.ancestors := p.ancestors || NEW.parent_id;
  END IF;
  NEW.depth := cardinality(NEW.ancestors);
  RETURN NEW;
END $$;

CREATE TRIGGER agents_path BEFORE INSERT ON "agents"
  FOR EACH ROW EXECUTE FUNCTION agents_set_path();

-- Agents can't change their parent (§2), and agent rows are never deleted
-- (ledger accounts and history point at them; closing is status = 'closed').
CREATE FUNCTION agents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agents are never deleted; set status = closed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.ancestors IS DISTINCT FROM OLD.ancestors
     OR NEW.depth IS DISTINCT FROM OLD.depth OR NEW.is_company IS DISTINCT FROM OLD.is_company THEN
    RAISE EXCEPTION 'an agent''s parent and hierarchy are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER agents_immutable_hierarchy BEFORE UPDATE OR DELETE ON "agents"
  FOR EACH ROW EXECUTE FUNCTION agents_guard();

CREATE TABLE "players" (
    "id" BIGSERIAL NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "phone_enc" TEXT NOT NULL,
    "telegram_user_id" TEXT,
    "agent_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "players_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "players_status_check" CHECK ("status" IN ('active', 'frozen', 'self_excluded', 'closed'))
);
CREATE UNIQUE INDEX "players_phone_hash_key" ON "players"("phone_hash");
CREATE UNIQUE INDEX "players_telegram_user_id_key" ON "players"("telegram_user_id");
CREATE INDEX "players_agent_id_idx" ON "players"("agent_id");
ALTER TABLE "players" ADD CONSTRAINT "players_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "agent_assignments" (
    "id" BIGSERIAL NOT NULL,
    "player_id" BIGINT NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMPTZ(6),
    "reason" TEXT NOT NULL,
    CONSTRAINT "agent_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_assignments_reason_check" CHECK ("reason" IN ('registration', 'transfer')),
    CONSTRAINT "agent_assignments_period" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
CREATE UNIQUE INDEX "agent_assignments_one_current" ON "agent_assignments"("player_id") WHERE "effective_to" IS NULL;
CREATE INDEX "agent_assignments_player_id_idx" ON "agent_assignments"("player_id");
CREATE INDEX "agent_assignments_agent_id_idx" ON "agent_assignments"("agent_id");
ALTER TABLE "agent_assignments" ADD CONSTRAINT "agent_assignments_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_assignments" ADD CONSTRAINT "agent_assignments_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- History is append-only; the one allowed change is closing a current row once.
CREATE FUNCTION agent_assignments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agent_assignments rows are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL
     OR (NEW.player_id, NEW.agent_id, NEW.effective_from, NEW.reason)
        IS DISTINCT FROM (OLD.player_id, OLD.agent_id, OLD.effective_from, OLD.reason) THEN
    RAISE EXCEPTION 'agent_assignments rows are immutable (only closing effective_to once is allowed)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER agent_assignments_append_only BEFORE UPDATE OR DELETE ON "agent_assignments"
  FOR EACH ROW EXECUTE FUNCTION agent_assignments_guard();

-- Staff and agent members log in with Telegram (Q-22); login itself is Task 04.
CREATE TABLE "staff" (
    "id" BIGSERIAL NOT NULL,
    "display_name" TEXT NOT NULL,
    "telegram_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_status_check" CHECK ("status" IN ('active', 'disabled'))
);
CREATE UNIQUE INDEX "staff_telegram_user_id_key" ON "staff"("telegram_user_id");

CREATE TABLE "roles" (
    "key" TEXT NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "staff_roles" (
    "staff_id" BIGINT NOT NULL,
    "role_key" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_roles_pkey" PRIMARY KEY ("staff_id", "role_key")
);
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_role_key_fkey"
  FOREIGN KEY ("role_key") REFERENCES "roles"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "agent_members" (
    "id" BIGSERIAL NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "display_name" TEXT NOT NULL,
    "telegram_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_members_status_check" CHECK ("status" IN ('active', 'disabled'))
);
CREATE UNIQUE INDEX "agent_members_telegram_user_id_key" ON "agent_members"("telegram_user_id");
CREATE INDEX "agent_members_agent_id_idx" ON "agent_members"("agent_id");
ALTER TABLE "agent_members" ADD CONSTRAINT "agent_members_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Seed (idempotent) ────────────────────────────────────────────────────────
-- Role list (permission matrix in src/auth/rbac.ts; proposal until Q-17).
INSERT INTO "roles" ("key") VALUES ('owner'), ('cofounder'), ('finance'), ('support'), ('staff_reviewer')
  ON CONFLICT DO NOTHING;

-- The company agent: owns every direct registration (§5.2).
INSERT INTO "agents" ("slug", "display_name", "is_company", "status")
  VALUES ('company', 'Company', true, 'active')
  ON CONFLICT DO NOTHING;

-- Company ledger accounts, plus the company agent's own agent accounts.
-- allow_negative must match ACCOUNT_TYPES in src/ledger/accountTypes.ts (tested).
INSERT INTO "accounts" ("type", "owner_kind", "owner_id", "allow_negative")
  SELECT t.type, t.owner_kind, t.owner_id, t.allow_negative
  FROM (
    SELECT 'COMPANY_FLOAT' AS type, 'company' AS owner_kind, 'company' AS owner_id, true AS allow_negative
    UNION ALL SELECT 'COMPANY_REVENUE', 'company', 'company', false
    UNION ALL SELECT 'AGENT_CASH_POSITION', 'agent', a.id::text, true FROM "agents" a WHERE a.is_company
    UNION ALL SELECT 'AGENT_PAYABLE', 'agent', a.id::text, false FROM "agents" a WHERE a.is_company
    UNION ALL SELECT 'PARENT_PAYABLE', 'agent', a.id::text, false FROM "agents" a WHERE a.is_company
  ) t
  ON CONFLICT DO NOTHING;

INSERT INTO "account_balances" ("account_id")
  SELECT acc.id FROM "accounts" acc
  WHERE (acc.owner_kind = 'company' AND acc.owner_id = 'company')
     OR (acc.owner_kind = 'agent' AND acc.owner_id IN (SELECT id::text FROM "agents" WHERE is_company))
  ON CONFLICT DO NOTHING;
