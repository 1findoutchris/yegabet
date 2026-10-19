# 01 · Project setup

Status: **built and tested locally; deploy blocked on Q-10 to Q-13 and Q-19/Q-20.**

## 1. Goal

A clean, boring foundation that every later task builds on: one TypeScript API
service with validated configuration, structured logs, a health endpoint that
proves the database is reachable, migration-only schema changes, feature flags
(off by default), CI that runs lint + typecheck + tests against a real Postgres,
and a Docker image that runs migrations and then starts.

## 2. Scope

**In**

- NestJS app (`src/main.ts`, `AppModule`), TypeScript strict mode
- Config: `src/config/env.ts`. A zod schema validates every env var at boot and
  refuses to start on bad config. `PLATFORM_NAME` / `PLATFORM_DOMAIN` are
  placeholders, never hardcoded.
- Logging: pino (JSON in prod, pretty in dev). Redacts `authorization`,
  `cookie`, `phone`, `token`, `password`, `reference` (§7).
- `GET /health`: `{status, db, version, time}`. HTTP 503 if the DB is down.
- Prisma with **migrations only** (`prisma migrate deploy` in the image)
- Tables: `config_versions` (dated config, used from Task 02 on), `feature_flags`
- Dockerfile (multi-stage, non-root), `docker-compose.yml` for local Postgres + Redis
- GitHub Actions CI: install → prisma generate → migrate a fresh Postgres → lint → typecheck → test
- `.env.example`, README with local run instructions

**Not in**

- Deploying staging/prod (needs Q-11, Q-12, Q-13), Sentry (Q-19), backup
  automation (Q-20). Documented as the deploy checklist below.
- Redis/BullMQ wiring: Redis is in compose and env schema as optional; the first
  job arrives in Task 06.
- Any frontend: Next.js arrives with Task 04.

## 3. Business rules used

- §4 stack defaults (pending Q-10)
- §8: "Features that are unfinished but deployed must sit behind feature flags, off by default."
- §2: "Name and domain undecided. Use placeholders/config, never hardcode a brand name."
- §2 config "with effective dates, so a change never rewrites history"

## 4. Data model changes

Migration `0001_init`:

```sql
CREATE TABLE config_versions (
  id            BIGSERIAL PRIMARY KEY,
  key           TEXT NOT NULL,           -- e.g. 'commission.split'
  value         JSONB NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key, effective_from)
);
CREATE TABLE feature_flags (
  key        TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`config_versions` is append-only: the value in force at time T is the row with
the greatest `effective_from ≤ T`. A trigger blocks UPDATE/DELETE, so history is
never rewritten.
**Down:** `DROP TABLE feature_flags; DROP TABLE config_versions;` (kept in
`prisma/migrations/0001_init/down.sql`; Prisma has no auto-down).

## 5. API / endpoints / jobs

| Route         | Roles  | Response                                                                            |
| ------------- | ------ | ----------------------------------------------------------------------------------- |
| `GET /health` | public | `200 {status:"ok", db:"ok", version, time}` or `503 {status:"degraded", db:"down"}` |

No jobs.

## 6. Money flow

None.

## 7. Edge cases

- Missing or invalid env var: the process exits non-zero with a readable list of what's wrong. It never starts half-configured.
- DB down at boot: the app still starts, and `/health` says 503 (the orchestrator can tell).
- Config lookup for a time before the first version: returns `null`, and the caller must treat that as "not configured" (no defaults for money).

## 8. Security

- Non-root container user. No secrets in the repo (`.env` is git-ignored).
- Log redaction list as above. Helmet-style headers come with the first non-health route.

## 9. Test plan

- Unit: env schema accepts a valid env, rejects a missing `DATABASE_URL`, rejects a bad `NODE_ENV`, parses `PORT`.
- DB integration: `/health` returns 200 with `db:"ok"` against the test DB.
  `config_versions` returns the right version for a timestamp (before / at / between / after),
  and UPDATE/DELETE on it raises an error. Feature flags default to off, and an unknown flag counts as off.

## 10. Deployment plan (when Q-11..13 are answered)

1. Railway project with environments `staging` and `production`, each with its own Postgres (+ Redis).
2. Service from the GitHub repo, Dockerfile build. The start command in the image runs `prisma migrate deploy && node dist/main.js`.
3. Set env vars from `.env.example` in each environment.
4. Turn on Railway Postgres backups; verify one restore into a scratch DB (full drill in Task 16).
5. Smoke test: `GET https://<staging>/health` returns 200 with `db:"ok"`; repeat on prod.
6. **Rollback:** redeploy the previous image. `0001_init` only adds tables, so it's safe to leave in place.

## 11. Risks and assumptions

- **Assumes Q-10 (stack) = the CLAUDE.md defaults with Prisma.** If you pick TypeORM, only the persistence adapter changes, because the ledger core is framework-free.
- Prisma can't express triggers, so they live as raw SQL inside the migration files (still migration-based).

## 12. Definition of done

- [x] Lint, typecheck and all tests pass locally against a real Postgres
- [ ] CI green on GitHub (needs Q-13)
- [ ] Staging + prod reachable, health live (needs Q-11/Q-12)
- [ ] Backups on and verified (Q-20)
