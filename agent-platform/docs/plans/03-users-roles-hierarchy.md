# 03 · Users, roles, hierarchy, company agent

Status: **plan only, awaiting owner approval.** Not built.

## 1. Goal

Model who everyone is and who owns whom: players, agents (with an immutable
parent and a stored ancestor path), staff with roles, and the company agent
that owns every direct sign-up. Every player always has exactly one agent,
and that history is kept. Each person or agent gets their ledger accounts
when created. Access rules are written once as backend policy functions and
tested, so later endpoints can't forget them.

## 2. Scope

**In**

- Tables `agents`, `players`, `agent_assignments`, `staff`, `roles`, `staff_roles`, `agent_members`
- Seed (in a migration): the company agent, the company ledger accounts, the role list
- `HierarchyService`: create agent (with parent), `ancestors(agentId, levels)`,
  `subtree(agentId)`, `parentAt(agentId, level)`
- `PlayerService.create` (agent from the referral slug, else the company agent)
  plus a first `agent_assignments` row. Ledger accounts are opened in the **same DB transaction**.
- RBAC: permission list, `can(principal, permission)`, and row-scope helpers
  (`playerScope`, `agentScope`, `childSummaryScope`). Deny by default.
- A Nest guard that reads a `Principal` from the request. **Producing** the
  principal (login) is Task 04, so tests inject principals directly.

**Not in**

- Login of any kind (players: Task 04; staff and agents: **Q-22**)
- Onboarding approvals (Task 08), storefront/branding (Task 09), player transfers (Task 15)
- Dashboards and child-summary _numbers_ (Task 11; they need settlement data)

## 3. Business rules used

- §5.2 "`agents.parent_id` is set at creation and is **immutable**. Store an ancestor path…"
- §5.2 "The **company agent** is a real agent record that owns direct registrations, so every player always has an `agent_id`."
- §5.2 "Player-to-agent history lives in an `agent_assignments` table with effective dates."
- §5.2 "an agent sees only their own subtree/players; a parent sees only **summary totals** of child agents, never child-player details."
- §2 "agents cannot change their parent"; "missing parent shares go to the company"
- §5.5 "One account per verified phone number."
- §3 "No recruitment rewards": creating an agent posts **no** ledger entries.

**Open questions**

- **Q-01** (depth) doesn't block: the ancestor path stores _all_ levels, and settlement reads `max_parent_levels` from config.
- **Q-22 (new):** how do staff and agent users log in? Telegram login like players, or password + 2FA? This is needed before any non-test endpoint goes live.
- **Q-23 (new):** are top-level agents parentless (my plan; parent shares then go to the company by rule), or children of the company agent? The money comes out the same, but the reports differ.

## 4. Data model (migration `0003_users`)

```sql
agents(
  id BIGSERIAL PK,
  slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  display_name TEXT NOT NULL,
  parent_id BIGINT REFERENCES agents,               -- NULL = top level
  ancestors BIGINT[] NOT NULL DEFAULT '{}',         -- root … direct parent
  depth INT NOT NULL,                               -- = cardinality(ancestors)
  is_company BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL CHECK (status IN ('active','paused','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now())
  -- UNIQUE (is_company) WHERE is_company: exactly one company agent
  -- GIN (ancestors): subtree = WHERE ancestors @> ARRAY[:id]
  -- trigger: UPDATE of parent_id / ancestors / depth / is_company raises an error
  -- trigger on INSERT: ancestors = parent.ancestors || parent.id (computed by the DB, never trusted from the app)
  -- CHECK: is_company → parent_id IS NULL

players(
  id BIGSERIAL PK,
  phone_hash TEXT UNIQUE NOT NULL,     -- HMAC-SHA256(phone, PHONE_HASH_KEY): uniqueness without plaintext
  phone_enc  TEXT NOT NULL,            -- AES-GCM ciphertext, for support/display only (§7)
  telegram_user_id TEXT UNIQUE,
  agent_id BIGINT NOT NULL REFERENCES agents,
  status TEXT NOT NULL CHECK (status IN ('active','frozen','self_excluded','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now())

agent_assignments(
  id BIGSERIAL PK, player_id → players, agent_id → agents,
  effective_from TIMESTAMPTZ NOT NULL, effective_to TIMESTAMPTZ,  -- NULL = current
  reason TEXT NOT NULL)                -- 'registration' | 'transfer' (Task 15)
  -- partial UNIQUE (player_id) WHERE effective_to IS NULL: one current agent
  -- append-only except closing effective_to once (trigger)

staff(id, display_name, status, created_at)
roles(key TEXT PK)                     -- seeded: owner, cofounder, finance, support, staff_reviewer
staff_roles(staff_id, role_key, granted_by, granted_at)  PK(staff_id, role_key)
agent_members(id, agent_id, display_name, status)        -- the people who run an agent's store
```

**Seed (in the migration, not app code):** the company agent `slug='company'`,
`is_company=true`, plus the accounts `COMPANY_FLOAT` and `COMPANY_REVENUE` (owner `company`)
and `AGENT_CASH_POSITION`, `AGENT_PAYABLE` and `PARENT_PAYABLE` for the company agent.

**Down:** drop the tables in reverse order. Seeded ledger accounts have no entries, so they're removable. Destructive in prod: approval required.

## 5. API / services

Internal services only. No public routes ship in this task. One **test-only**
module exercises the guard (it isn't mounted in production).

| Permission                | owner | cofounder | finance | support | agent member                                  |
| ------------------------- | ----- | --------- | ------- | ------- | --------------------------------------------- |
| `agents.read.all`         | ✓     | ✓         | ✓       | ✓       | –                                             |
| `agents.create`           | ✓     | ✓         | –       | –       | –                                             |
| `players.read.all`        | ✓     | ✓         | ✓       | ✓       | –                                             |
| `players.read.own`        | –     | –         | –       | –       | ✓ (own agent's players only)                  |
| `agents.children.summary` | –     | –         | –       | –       | ✓ (direct + deeper children, **totals only**) |
| `config.write`            | ✓     | –         | –       | –       | –                                             |

_Proposed matrix; adjust it with Q-17._

## 6. Money flow

**None.** Opening accounts posts no entries (§3: no recruitment rewards).

- Creating an agent opens 3 accounts at balance 0: `AGENT_CASH_POSITION`, `AGENT_PAYABLE` and `PARENT_PAYABLE`.
- Creating a player opens 2: `PLAYER_WALLET` and `PLAYER_HELD`.
- Check after the tests: `ledger:check` still shows Σ = 0 with no entries added.

## 7. Edge cases

| Case                                                | Handling                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Attempt to change `parent_id` (app or SQL)          | DB trigger raises an error                                                                                                                     |
| A parent that's paused/closed when creating a child | Refused                                                                                                                                        |
| A cycle                                             | Impossible: the parent must already exist, and parent_id is immutable                                                                          |
| Duplicate phone (same number, different format)     | Normalize to E.164 before hashing → unique violation → "already registered"                                                                    |
| Referral slug unknown or agent paused               | Falls back to the company agent? **No: refused with "invalid link"** (silent reassignment would hide a broken agent link). Confirm in Task 04. |
| Player created but account opening fails            | One DB transaction, so no player exists without accounts                                                                                       |
| Parent level asked beyond depth                     | `parentAt` returns null, and settlement sends that share to the company                                                                        |

## 8. Security

- Phone numbers are never stored or logged in plain text: hash for uniqueness, AES-GCM for display. `PHONE_HASH_KEY` and `PHONE_ENC_KEY` are new secrets.
- Deny by default: the guard rejects any route without an explicit `@Requires(permission)`.
- Row scopes are applied in the query, not filtered after fetching.

## 9. Test plan

- Hierarchy: A → B → C → D. `ancestors(D)` = [A, B, C], `parentAt(D, 1)` = C, `parentAt(D, 2)` = B, `parentAt(D, 4)` = null, `subtree(B)` = {C, D}.
- DB rejects `UPDATE agents SET parent_id …`, a second company agent, and a company agent with a parent.
- A player with no referral gets the company agent; with slug `b` gets B. Each has exactly 1 current assignment.
- Same phone in `0912345678` and `+251912345678` forms: the second is refused.
- Accounts opened with balance 0; `ledger:check` ok.
- RBAC: each matrix cell, positive and negative. An agent member of B can read B's players but not C's player rows, and can read C's _summary_ (only aggregate fields are returned).
- Property: random trees (≤ 50 agents). For every node, `ancestors` matches walking `parent_id`, and `depth` = its length.

## 10. Deployment

- Additive migration plus seed. The feature flag `users.v1` stays off (no public routes anyway).
- Post-deploy: the company agent exists exactly once, and `ledger:check` is ok.
- Rollback: redeploy the previous image; leave the tables.

## 11. Risks and assumptions

- Assumes the roles in §5 until Q-17 is answered.
- Phone encryption keys must be backed up separately: losing `PHONE_ENC_KEY` means losing phone display (the hash still works).

## 12. Definition of done

- [ ] Migration up/down tested; seed idempotent
- [ ] All tests above pass; 100% coverage of hierarchy + RBAC policy code
- [ ] `ledger:check` ok after the test run
- [ ] Owner approves the role matrix (Q-17) and answers Q-22/Q-23 before any route goes public
