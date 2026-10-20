| Q-33 | ~~Auto-complete~~ **Answered 2026-10-20 ("continue" = proposals accepted):** 24 h after the agent marks it paid | — |
| Q-32 | ~~Proof~~ **Answered 2026-10-20 ("continue" = proposals accepted):** a typed payment reference; screenshots later | — |
| Q-31 | ~~Payout destination~~ **Answered 2026-10-20 ("continue" = proposals accepted):** only the player's verified phone number | — |
| Q-07 | ~~Withdrawal limits and SLA~~ **Answered 2026-10-20 ("continue" = proposals accepted):** min 50 ETB, max 100,000 ETB, SLA 24 h | — |
| Q-30 | ~~Pending deposit expiry~~ **Answered 2026-10-19:** **24 h**, then it expires | — |
| Q-31 | Withdrawals paid only to the player's verified (Telegram) phone number? Proposal: yes. | Task 06 |
| Q-32 | A typed payment reference is enough proof for now (screenshots later)? Proposal: yes. | Task 06 |
| Q-33 | Agent marked a withdrawal paid, the player never answers: auto-complete after? Proposal: 24 h. | Task 06 |
| Q-28 | ~~Deposit override~~ **Answered 2026-10-19:** **owner** only (finance can be added later) | — |
| Q-27 | ~~Deposit limits~~ **Answered 2026-10-19:** min **15 ETB**, max **100,000 ETB** (config) | — |
| Q-26 | ~~SMS sign-up~~ **Answered 2026-10-19:** no, for now. Telegram only. | — |
| Q-27 | Deposit minimum / maximum? Proposal: min 10 ETB, max 100,000 ETB (config). | Task 05 |
| Q-28 | Who may override deposits (confirm/reject any)? Proposal: owner + finance. | Task 05 |
| Q-29 | ~~Who adds payment accounts~~ **Answered 2026-10-19: the agent, themselves** (agent members add and deactivate their own agent's numbers; every change is audited) | — |
| Q-30 | How long can a deposit stay pending? Proposal: 48 h, then it expires (auto-rejected). | Task 05 |
| Q-24 | ~~Session lifetime~~ **Answered 2026-10-19:** 12 h | — |
| Q-25 | ~~First owner~~ **Answered 2026-10-19:** Telegram user id 5347803735 becomes the first owner (`npm run staff:add`) | — |
| Q-14 | ~~Telegram bot~~ **Answered 2026-10-19:** a **new** bot from @BotFather, for the agent platform only (the old site keeps its bot) | — |
| Q-22 | ~~Staff/agent login~~ **Answered 2026-10-19:** Telegram login for everyone (players, agents, staff) | — |
| Q-12 | ~~Staging + prod~~ **Answered 2026-10-19:** yes, separate Railway environments and databases | — |
| Q-11 | ~~Hosting~~ **Answered 2026-10-19:** Railway | — |
| Q-10 | ~~Stack~~ **Answered 2026-10-19:** approved with plan 01 (NestJS + Prisma + Postgres + Redis/BullMQ + Next.js) | — |

# Open questions (parked; answer when ready)

Each one says what it blocks and what I'm doing in the meantime.
**Nothing here has been guessed into money logic.**

## Business rules (from CLAUDE.md §2 "Open decisions")

| ID   | Question                                                                                                                                                                                                                                                                                                             | Blocks          | Meanwhile                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------- |
| Q-01 | **Partly answered 2026-10-19: 3 paid parent levels.** Still open: level 3's % and whose share shrinks (today's split already sums to 100%). Options shown to the owner: a) agent 55 / P3 5, b) company 5 / P3 5, c) P2 5 / P3 5.                                                                                     | Task 10         | `max_parent_levels` = 3 once the % is known.        |
| Q-02 | Keep **per-provider, no carry-forward**? This lets the company pay commission even when players won overall.                                                                                                                                                                                                         | Task 10         | Built as written (per provider).                    |
| Q-03 | Are bonuses, promos, refunds and payment-method fees deducted from `G` before the split?                                                                                                                                                                                                                             | Task 10         | Not deducted. Task 10 won't start until answered.   |
| Q-04 | Same split for every agent, or per-agent overrides?                                                                                                                                                                                                                                                                  | Task 10         | Config model allows a per-agent override row later. |
| Q-05 | Is the 10% "provider fee" the provider's real fee (often charged on all GGR, even losing periods) or a reserve?                                                                                                                                                                                                      | Task 10         | Treated as a split line only.                       |
| Q-06 | ~~Who pays withdrawals~~ **Answered:** from the agent's cash (2026-10-19). **Over-limit (Q-06b), Answered 2026-10-20 ("continue" = proposals accepted):** allowed. The agent pays from their own money, their cash position can go positive (the platform owes them), and settlement nets it. Float size still open. | Task 10 (float) |
| Q-07 | Withdrawal min / max and SLA. Proposal: min 50 ETB, max 100,000 ETB, SLA 24 h.                                                                                                                                                                                                                                       | Task 06         | Config.                                             |
| Q-08 | Responsible-gambling defaults: deposit/loss limit periods, cool-off lengths, minimum age                                                                                                                                                                                                                             | Task 13         | Hooks only.                                         |
| Q-09 | Rounding: confirm "floor to whole birr, remainder to company"                                                                                                                                                                                                                                                        | Task 10         | That default is in the plan's worked example.       |

## Setup / infrastructure (needed for Task 01 DEPLOY)

| ID   | Question                                                                                                                                                                                                                         | Blocks                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Q-10 | Confirm stack: **NestJS + Prisma + Postgres + Redis/BullMQ + Next.js** (the CLAUDE.md defaults, with Prisma as the ORM since you already use it)                                                                                 | Task 01 sign-off            |
| Q-11 | Hosting: **Railway** like YegaBet? (one project with prod + staging environments, Postgres + Redis plugins)                                                                                                                      | Task 01 deploy              |
| Q-12 | Staging and production as separate Railway environments, with separate databases?                                                                                                                                                | Task 01 deploy              |
| Q-13 | ~~GitHub repo~~ **Answered:** the yegabet repo, folder `agent-platform/`                                                                                                                                                         | —                           |
| Q-14 | A new Telegram bot for this platform (token + username)                                                                                                                                                                          | Task 04                     |
| Q-15 | ~~Platform name + domain~~ **Answered 2026-10-19: YegaBet, yega.bet** (set via `PLATFORM_NAME` / `PLATFORM_DOMAIN`)                                                                                                              | —                           |
| Q-16 | First provider: Octhera? Separate Octhera account/key from YegaBet's?                                                                                                                                                            | Task 07                     |
| Q-17 | Who are the cofounders/staff in the approval chain (roles, how many approvals needed)?                                                                                                                                           | Task 08                     |
| Q-18 | ~~Replace or run alongside?~~ **Answered 2026-10-19: the agent platform replaces the old single-site YegaBet web app.** Existing players, balances and history must be migrated into the ledger. That needs its own plan (M-01). | M-01                        |
| Q-19 | Error tracking: Sentry OK? (needs a DSN)                                                                                                                                                                                         | Task 01 observability       |
| Q-20 | Backups: Railway's built-in Postgres backups enough, or also a nightly dump to S3/R2?                                                                                                                                            | Task 01 deploy              |
| Q-22 | How do **staff and agent users** log in? Telegram login like players, or password + 2FA?                                                                                                                                         | Task 03 routes going public |
| Q-23 | Top-level agents: parentless (my plan; parent shares go to the company by rule) or children of the company agent?                                                                                                                | Task 03                     |
| Q-26 | Sign-up needs a Telegram account (phone proof = Telegram contact share, §5.5). Also offer **SMS sign-up** for people without Telegram (the old app had AfroMessage)? That would be a rule change.                                | Task 04 follow-up           |

## Migration from the old YegaBet: resolved 2026-10-19

The old app has **no real users**, so there is nothing to migrate: no players, balances or history. M-01 to M-04 are closed, Task 07b is dropped, and bonus balances are not a concern. Cut-over is simply pointing yega.bet at the new platform when it is ready.

**Timeline set by the owner: 3 days.** Proposed scope is in `docs/plans/00-master-plan.md` §6.

## Found while building (no decision needed yet; scheduled)

| ID   | Item                                                                                                                                                                                                                                                                                 | When                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| H-01 | The DB triggers stop edits and deletes, but the **table owner** can still `DROP TABLE` or `ALTER TABLE … DISABLE TRIGGER`. In production the app should connect as a role that does **not** own the tables (a separate migration role does). Railway's default user owns everything. | Task 01 deploy / Task 16 |

## Legal (§3, flag at every money milestone)

| ID   | Item                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-01 | Lawyer confirmation: betting operations, agent-held customer funds, multi-level revenue share in Ethiopia, and Telebirr / CBE Birr / eBirr terms. **Not confirmed.** |
