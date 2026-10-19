-- 0001_init: dated config + feature flags (plan 01).

CREATE TABLE "config_versions" (
    "id" BIGSERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "config_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "config_versions_key_effective_from_key" ON "config_versions"("key", "effective_from");

CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- Config history is never rewritten: a change is a new row with a later effective_from.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER config_versions_immutable
  BEFORE UPDATE OR DELETE ON "config_versions"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER config_versions_no_truncate
  BEFORE TRUNCATE ON "config_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
