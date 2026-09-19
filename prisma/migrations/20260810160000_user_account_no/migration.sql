-- Player-facing numeric account number (9 digits), unique per user.
--
-- Added nullable, backfilled, then locked down: an existing table can't take a
-- NOT NULL column whose values have to be unique in one statement.

ALTER TABLE "users" ADD COLUMN "accountNo" INTEGER;

-- Created BEFORE the backfill on purpose: Postgres allows many NULLs under a
-- unique index, and the loop below relies on this index to raise the collision
-- it retries on.
CREATE UNIQUE INDEX "users_accountNo_key" ON "users"("accountNo");

-- One random number per existing user, re-rolled on the (rare) clash.
DO $$
DECLARE
  target_id TEXT;
  candidate INTEGER;
BEGIN
  FOR target_id IN SELECT id FROM "users" WHERE "accountNo" IS NULL LOOP
    LOOP
      candidate := (100000000 + floor(random() * 900000000))::int;
      BEGIN
        UPDATE "users" SET "accountNo" = candidate WHERE id = target_id;
        EXIT; -- assigned
      EXCEPTION WHEN unique_violation THEN
        -- taken; loop re-rolls
      END;
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE "users" ALTER COLUMN "accountNo" SET NOT NULL;

-- The default is what fills the column for every new signup, so no application
-- path can create a user without an account number.
ALTER TABLE "users"
  ALTER COLUMN "accountNo"
  SET DEFAULT ((100000000 + floor((random() * (900000000)::double precision))))::integer;
