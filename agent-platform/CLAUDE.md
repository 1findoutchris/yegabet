# CLAUDE.md: Agent Gaming Platform

Read this whole file before doing anything. It is the source of truth for what we are building and how we work. If something here conflicts with what you assume, this file wins. If something is missing or ambiguous, **ask; do not guess**, especially for anything involving money.

---

## 0. Working rules (most important)

We build **one task at a time**. For every task, follow this loop exactly:

1. **PLAN**: Write a detailed plan for the task _before writing any code_ (format in section 9). Save it to `docs/plans/<NN>-<task-name>.md` and show it to the owner. **Stop and wait for approval.**
2. **BUILD**: Implement only what the approved plan covers. No extra features, no drive-by refactors.
3. **TEST**: Write and run tests (unit, integration, and for money code, property/invariant tests). Everything must pass. Report the real output, not a summary.
4. **DEPLOY**: Deploy to production using the deployment checklist (section 10). Verify with a smoke test in production.
5. **REPORT**: Tell the owner what was done, what was tested, what is live, and any follow-ups. Wait for "continue" before starting the next task.

Hard rules:

- Never start the next task before the current one is tested, deployed, and confirmed by the owner.
- Never mark a task done if any test is failing, skipped, or was not run. Say so plainly instead.
- Never invent business rules. If a formula, percentage, or policy is not in this file, ask.
- Never change money logic, the ledger schema, or settlement rules without a new approved plan.
- Never run destructive commands (drop tables, delete data, force-push, reset production) without explicit written approval for that exact action.
- Never commit secrets. Use environment variables and a secrets manager.
- If a plan turns out wrong mid-build, stop, explain, and update the plan. Do not improvise.

---

## 1. Product overview

A **gaming platform** operated by the company (the owner and cofounders) through **agents** (a.k.a. "owners"). It has two sides:

- **Players** play games supplied by third-party **providers**.
- **Agents** are vetted partners who get a branded storefront (like a Shopify store), register their own players, handle those players' deposits and withdrawals, and earn a revenue share from their players' results.

The company controls everything: who becomes an agent, the hierarchy, payments oversight, settlement, and audit. The company also has its **own direct players** who register on the main website with no agent.

There are **two main surfaces**:

1. **Player surface**: website + Telegram Mini App; player dashboard.
2. **Agent surface**: storefront admin + agent dashboard.
   Plus a **Company admin back office** (central control).

---

## 2. Confirmed decisions

| Area                 | Decision                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Website              | New website. **Name and domain undecided.** Use placeholders/config, never hardcode a brand name.                   |
| Agent branding       | Own storefront name and logo; referral links initially (subdomains/custom domains later)                            |
| Agent rights         | Revenue rights from assigned players only. **No company equity.**                                                   |
| Currency / language  | ETB (Ethiopian Birr); English                                                                                       |
| Agent approval       | Staff, the owner, and cofounders review financial capacity, customer base, and previous experience                  |
| Joining costs        | **No joining fee and no initial reserve** currently                                                                 |
| Hierarchy            | Paid parent levels above each agent; missing parent shares go to the company; **agents cannot change their parent** |
| Player registration  | Telegram phone verification; via website and Telegram Mini App                                                      |
| Direct registrations | Assigned to a **company-controlled agent** record                                                                   |
| Player transfers     | Allowed only after unsettled bets finish, with balance reconciliation                                               |
| Payments             | Telebirr, CBE Birr, eBirr; agent-owned accounts; manual and automatic verification                                  |
| Withdrawals          | Agent and platform both involved; **timing undecided** (use a configurable SLA, default 24h)                        |
| Profit               | Calculated **separately per provider**; provider fees deducted; **no loss carry-forward**                           |
| Settlement           | Every **10 days**, reviewed and approved before payment                                                             |
| Visibility           | Agents see their own full results; parents see **summaries** of child agents' profit/loss only                      |
| Administration       | Central control, financial exports, statements, audit history                                                       |

### Commission split (configurable, never hardcoded)

Applied to **positive** gross result per agent, per provider, per 10-day period:

| Beneficiary    | Share |
| -------------- | ----- |
| Agent          | 60%   |
| Company        | 10%   |
| Provider fee   | 10%   |
| Parent level 1 | 10%   |
| Parent level 2 | 10%   |

If a parent level does not exist, that share goes to the company. Store all percentages and the number of parent levels in a **config table with effective dates**, so a change never rewrites history.

### Open decisions: DO NOT guess, ask the owner

- **Hierarchy depth:** earlier answers said three paid parent levels; the split above shows two. Build depth as config (`max_parent_levels`) and ask which value to use at launch.
- **Net across providers?** Current rule is per-provider with no carry-forward. This means the company can pay out more than players actually lost. Ask before changing it.
- Are bonuses, promos, refunds, and payment-method fees deducted before the split?
- Is the split identical for every agent or set per agent?
- Who holds the company float, and how large must it be at launch?
- Do withdrawals come out of the agent's accounts or the company float?
- Withdrawal timing, minimum payout threshold, rounding rule (default: round down to whole birr, remainder to company).

---

## 3. Compliance guardrails (non-negotiable)

- **No recruitment rewards.** Money flows only from **player net results**. Never add sign-up bonuses, recruiting bonuses, or any payment for bringing in agents. Never charge agents joining fees without a new approved decision.
- Build **age and identity checks** hooks and **responsible-gambling tools** (deposit/loss limits, self-exclusion, cool-off) into the design from the start.
- Keep an **append-only audit log** of every sensitive action (who, what, when, before/after, IP).
- The owner must confirm with a lawyer that betting operations, agent-held customer funds, and the multi-level revenue share are permitted in Ethiopia and under payment-provider terms. Flag this at every relevant milestone; do not assume it is settled.

---

## 4. Tech stack (defaults; confirm before the first task)

- **Backend:** Node.js + TypeScript (NestJS), PostgreSQL, Redis (queues/locks), BullMQ or similar for jobs.
- **ORM/migrations:** TypeORM or Prisma, **migration-based only** (no manual schema edits in prod).
- **Frontend:** React/Next.js (web) and a Telegram Mini App sharing components where possible.
- **Auth:** Telegram `initData` signature validation on the server; sessions/JWT with short expiry; role-based access control.
- **Infra:** Docker, CI pipeline, staging and production environments, automated DB backups.
- **Observability:** structured logs, error tracking, alerts on failed jobs, ledger imbalance, and callback errors.

If the owner picks a different stack, update this section first.

---

## 5. Architecture rules

### 5.1 Ledger (the heart of the system, build it first)

- **Double-entry, append-only.** Every movement is an immutable row: `debit_account`, `credit_account`, `amount`, `currency`, `reason`, `reference_id`, `idempotency_key` (unique), `created_at`.
- **Balances are derived** from ledger rows (a cached balance table is allowed but must be reconcilable and rebuildable).
- **Never** `UPDATE` a balance directly. **Never** edit or delete a ledger row. Corrections are new reversing entries.
- All money in **integer minor units** (no floats). Use a decimal/bigint library.
- Every write that touches money runs inside a **database transaction with row locking**; concurrent requests must not double-spend.
- Every external callback and API call that moves money must be **idempotent**.
- Invariant to test constantly: **sum of all debits = sum of all credits**, and no player/agent wallet goes negative unless explicitly allowed.

Accounts (at minimum): player wallet, player held funds (pending withdrawals), agent cash position (platform money held by the agent), agent payable (commission owed), parent payable, company float, company revenue, provider payable, provider fees.

### 5.2 Users, roles, hierarchy

- Tables: `players`, `agents`, `staff`, roles/permissions.
- `agents.parent_id` is set at creation and is **immutable**. Store an ancestor path (materialized path or closure table) so parents are looked up without recursion.
- The **company agent** is a real agent record that owns direct registrations, so every player always has an `agent_id` and no code has a null special case.
- Player-to-agent history lives in an `agent_assignments` table with effective dates.
- Access control enforced **in the backend** (row-level filters): an agent sees only their own subtree/players; a parent sees only **summary totals** of child agents, never child-player details.

### 5.3 Agent onboarding

- Application, then staff review, then owner review, then cofounder review. Each step approves/rejects with notes; all logged.
- Approval creates: agent record, storefront, referral link, default payment-account slots.
- Keep applications for audit.

### 5.4 Storefront (multi-tenant)

- One codebase; tenant resolved by slug/subdomain (e.g. `slug.<domain>`), domain from config.
- Per-agent branding (name, logo, colors), assigned payment accounts, referral link.
- Telegram deep link (`?start=agent_slug`) attaches a new player to that agent.

### 5.5 Player registration

- Verified phone via Telegram contact share. **Validate `initData` HMAC on the server; never trust the client for identity.**
- New player gets `agent_id` from the referral link, else the company agent.
- One account per verified phone number.

### 5.6 Game providers (seamless wallet)

- Providers call our API for `bet`, `win`, `rollback`, `balance`. Authenticate and sign/verify every callback.
- Idempotent by provider transaction ID. Handle retries, out-of-order delivery, and rollbacks.
- Store each bet with `provider_id`, `player_id`, **`agent_id` snapshot at bet time**, `status` (open/settled/rolled_back), `settled_at`, amounts.
- Build behind a provider-adapter interface so adding provider #2 does not change core code.

### 5.7 Deposits

1. Player picks one of their agent's payment accounts, pays, submits the transaction reference.
2. Verification: **automatic** (SMS/notification match) or **manual** (agent confirms; staff can override).
3. On verification: credit player wallet, debit agent cash position (agent now holds that cash for the platform).

- Duplicate transaction references must be rejected.

### 5.8 Withdrawals

1. Player requests, amount moves to **held**.
2. Agent pays from their own account and uploads proof.
3. Player confirms or staff verify; hold is finalized; agent cash position reduced.
4. If the agent misses the SLA, auto-escalate to staff.

- Respect the player's pending open bets and responsible-gambling limits.

### 5.9 Player transfers between agents

- Allowed only when the player has **zero open bets**.
- Freeze account, reconcile balance, write assignment-history row, switch `agent_id`, unfreeze. Old bets stay attributed to the old agent.

### 5.10 Settlement engine (every 10 days)

For each agent and each provider, for bets **settled within the period**:

1. `G = stakes − winnings paid`.
2. `G <= 0`, so distributable = 0. **No carry-forward.**
3. `G > 0`, so split by the configured percentages (section 2); missing parents' shares go to the company.
4. Apply the rounding rule (default: floor to whole birr, remainder to company).
5. Write `settlement_lines` (agent, beneficiary, provider, amount, rule/config version) and a **draft statement**.
6. Finance review, then owner/cofounder approval, all logged.
7. Approved statements are **immutable**. Later disputes/reversals become adjustments in the **next** period.
8. Generate **cash-netting instructions** (agents hold platform cash; compare cash position with commission owed and tell each agent what to remit or keep).

- The settlement job must be **idempotent and re-runnable** for a period without double-paying. Periods lock when closed.
- Bets still open at period end roll into the next period.

### 5.11 Dashboards

- **Player:** wallet, bet history, deposits/withdrawals, limits.
- **Agent:** own players, deposit/withdrawal queue, cash position, full per-provider results, statements.
- **Parent view:** child-agent summary (profit/loss totals) only.
- **Admin:** application queue, agent list and health (player count, volume, open liability), settlement review, exports (CSV/Excel), audit log, exposure limits, config.

### 5.12 Exposure and risk controls

- Per-agent caps on daily/per-bet payouts and open liability; ability to pause an agent's players when a threshold is hit.
- Alerts when the company float falls below a configured minimum.

---

## 6. Customer winnings funding (recommended default; confirm)

**Company float funds winnings; agents only earn revenue share**, with per-agent exposure limits. Agents do not fund payouts. Build the float as a ledger account with balance alerts. Do not build agent-funded payouts unless the owner changes this decision.

> **Owner decision 2026-10-20 (Q-34): changed.** Game money moves against the player's **agent** ("the agent or owner wallet, not the company"); for direct players that is the company agent. A bet moves PLAYER_WALLET → the agent's AGENT_CASH_POSITION, and a win moves it back. The agent therefore carries game results directly. How this combines with the commission split and "no loss carry-forward" must be settled in the Task 10 plan with worked numbers.

---

## 7. Security and quality standards

- Validate all input; parameterized queries only; rate-limit auth, deposit, and withdrawal endpoints.
- RBAC on every endpoint; deny by default.
- Encrypt sensitive data at rest where applicable; never log full phone numbers, tokens, or payment references in plain text.
- All admin actions require authentication plus an audit entry.
- Test coverage expectations: **100% of ledger, settlement, and commission code paths**; critical flows covered by integration tests.
- Code style: TypeScript strict mode, linting and formatting enforced in CI, small focused commits with clear messages.

---

## 8. Task roadmap (one at a time, in order)

Each task goes through the full PLAN, BUILD, TEST, DEPLOY loop (section 0).

| #   | Task                                                                                                 | Done when                                                    |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 01  | Project setup: repo, CI, environments (staging/prod), config system, DB migrations, logging, backups | CI green; prod and staging reachable; health endpoint live   |
| 02  | Ledger core + accounts + idempotency + invariants tests                                              | Debits=credits proven by tests; concurrency tests pass       |
| 03  | Users: players, agents, staff, roles, company agent, immutable parent, ancestor path                 | Hierarchy lookups tested, RBAC enforced                      |
| 04  | Player registration via Telegram (website + Mini App), referral attach                               | initData validated; phone verified; agent attached correctly |
| 05  | Deposits (manual verification first)                                                                 | Verified deposit moves ledger correctly; duplicates rejected |
| 06  | Withdrawals with hold, proof, SLA escalation                                                         | Full lifecycle tested including escalation                   |
| 07  | First provider integration (seamless wallet) + bet storage with agent snapshot                       | Bet/win/rollback idempotent and tested                       |
| 08  | Agent onboarding workflow (staff, owner, cofounders)                                                 | Approval creates agent, storefront, referral link            |
| 09  | Storefront multi-tenancy + branding + payment-account assignment                                     | Tenant isolation verified                                    |
| 10  | Settlement engine + draft statements + review/approval + cash netting                                | Example scenarios match hand-calculated results              |
| 11  | Dashboards: player, agent, parent summaries, admin                                                   | Access-control tests pass                                    |
| 12  | Admin tools: exports, audit log viewer, config management                                            | Exports reconcile to ledger                                  |
| 13  | Exposure limits, float alerts, responsible-gambling tools                                            | Limits enforced and tested                                   |
| 14  | Automatic deposit verification                                                                       | Auto and manual paths coexist                                |
| 15  | Player transfers between agents                                                                      | Blocked with open bets; reconciliation tested                |
| 16  | Hardening: load test, security review, backup restore drill, runbooks                                | Restore drill passes; load targets met                       |

Do not reorder without owner approval. Features that are unfinished but deployed must sit behind **feature flags**, off by default.

---

## 9. Plan template (required before each task)

Create `docs/plans/<NN>-<task-name>.md` with:

1. **Goal**: one paragraph, plain language.
2. **Scope**: what is included and, explicitly, what is **not**.
3. **Business rules used**: quote the relevant rules from this file; list any open question and **ask before continuing**.
4. **Data model changes**: tables, columns, indexes, migrations (up and down).
5. **API/endpoints and jobs**: routes, payloads, roles allowed, background jobs.
6. **Money flow** (if any): exact ledger entries for each scenario, with a worked numeric example.
7. **Edge cases and failure modes**: retries, duplicates, concurrency, partial failure, rollbacks.
8. **Security and permissions**.
9. **Test plan**: unit, integration, invariant/property tests, and the specific scenarios with expected numbers.
10. **Deployment plan**: migration order, feature flag, rollback steps, post-deploy smoke tests.
11. **Risks and assumptions**.
12. **Definition of done** (checklist).

Wait for explicit owner approval ("approved") before coding.

---

## 10. Test and production deployment checklist

**Before deploying:**

- [ ] All tests pass locally and in CI; nothing skipped
- [ ] Ledger invariant tests pass
- [ ] Migrations tested up **and** down on a copy of staging data
- [ ] Fresh database backup taken and verified
- [ ] Secrets and environment variables set in production
- [ ] Feature flag in place for anything not fully finished
- [ ] Rollback plan written in the plan file

**Deploy:**

- [ ] Run migrations (backward-compatible; expand then contract)
- [ ] Deploy application
- [ ] Run production smoke tests (health, login, one read-only money check, one safe end-to-end flow for the task)
- [ ] Verify ledger totals still balance
- [ ] Monitor logs and error tracking for at least 15 minutes

**After deploying:**

- [ ] Report to the owner: what shipped, test results, smoke-test results, known issues
- [ ] If anything fails: **roll back first, investigate second**, then report
- [ ] Wait for the owner's go-ahead before starting the next task

No test data in production ledgers. Use clearly marked test accounts/flows that can be excluded from settlement and reports, and clean them up only with approval.

---

## 11. Communication style

- Be concise and exact. Report real command output and real test results.
- State assumptions explicitly and ask when unsure.
- When money logic is involved, always show a worked numeric example.
- Never say a task is done unless section 0's loop is complete.
