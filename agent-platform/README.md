# Agent gaming platform: API

The source of truth for what we build and how is [`CLAUDE.md`](CLAUDE.md).
Plans live in [`docs/plans/`](docs/plans), and parked questions in
[`docs/open-questions.md`](docs/open-questions.md).

| Task                  | Status                                            |
| --------------------- | ------------------------------------------------- |
| 00 Master plan        | Draft, awaiting owner review                      |
| 01 Project setup      | Approved · built + tested locally · deploy next   |
| 02 Ledger core        | Approved · built + tested locally (100% coverage) |
| 03 Users, roles, tree | Approved · built + tested locally (100% coverage) |

## Run locally

Requirements: Node 20+, PostgreSQL 15+ (or `docker compose up -d`).

```sh
npm install
cp .env.example .env            # set DATABASE_URL
npx prisma migrate deploy       # migrations only, never `db push`
npm run dev                     # http://localhost:3000/health
```

## Tests

DB tests **wipe and re-migrate** the database in `TEST_DATABASE_URL`, and refuse
to run unless its name ends in `_test`.

```sh
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agent_platform_test
npm test            # unit + DB + concurrency + property tests
npm run test:cov    # same, with the 100% coverage gate on src/ledger
npm run lint && npm run typecheck && npm run format:check
```

## Money, in one paragraph

All money goes through `src/ledger` and nothing else. It's stored as `bigint` santim
(1 ETB = 100). Every posting is an immutable double-entry row set under one
idempotency key, applied inside a DB transaction that locks the touched balances.
Postgres triggers reject edits or deletes of ledger rows and any balance change
outside a posting. `npm run ledger:check` verifies Σ balances = 0, no forbidden
negatives, and cache = entries. See [`docs/plans/02-ledger-core.md`](docs/plans/02-ledger-core.md).
