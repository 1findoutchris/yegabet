# 00 · Master plan: Agent Gaming Platform

Status: **draft, awaiting owner review.** Source of truth: `CLAUDE.md`.
Open questions are collected in `docs/open-questions.md` (referenced here as **Q-xx**).

---

## 1. What we are building (my understanding, please correct)

A company-run gaming platform whose growth channel is **agents**: vetted partners who
run a branded storefront, sign up their own players, handle those players' cash
in and out on Telebirr / CBE Birr / eBirr, and earn a share of the profit their
players generate. Players play third-party provider games (seamless wallet).

Three ideas carry everything else:

1. **Money is a ledger, not a balance column.** Every birr that moves is an immutable
   double-entry row. Balances are derived. Corrections are reversing entries.
2. **Every player belongs to exactly one agent at any moment**, including direct
   sign-ups, who belong to the _company agent_. History is kept, so every bet is
   attributed to the agent who owned the player _when the bet was placed_.
3. **Agents earn from player results only.** Every 10 days, per agent and per provider:
   `G = stakes − winnings`. If `G > 0`, it's split by a dated config (60/10/10/10/10).
   If `G ≤ 0`, nothing is split and nothing carries forward. Statements are
   drafted, reviewed, approved, then frozen.

Agents physically hold platform cash: a player's deposit lands in the agent's own
Telebirr account. The ledger tracks this as the **agent cash position**. Settlement
nets "cash you hold for us" against "commission we owe you" and tells each agent
what to remit or keep.

### Worked example: the split (to confirm I read it right)

Agent A has parent P1, and P1 has parent P2. Period 1–10 Nov, provider Octhera:
stakes 50,000.00 ETB, winnings paid 40,000.00 ETB, so **G = 10,000.00 ETB**.

| Beneficiary    | %   | Amount        |
| -------------- | --- | ------------- |
| Agent A        | 60  | 6,000.00      |
| Company        | 10  | 1,000.00      |
| Provider fee   | 10  | 1,000.00      |
| Parent L1 (P1) | 10  | 1,000.00      |
| Parent L2 (P2) | 10  | 1,000.00      |
| **Total**      | 100 | **10,000.00** |

- **If A has no parents**, the company gets 10 + 10 + 10 = 30%, which is 3,000.00.
- **Rounding** (default: floor to whole birr, remainder to company), with G = 1,234.57:
  - Agent: floor(740.742) = 740
  - Provider: floor(123.457) = 123
  - P1: 123
  - P2: 123
  - Company: floor(123.457) = 123, plus the remainder 1,234.57 − 1,232 = 2.57, so **125.57**
  - Total: 1,234.57 ✓
- **If the same agent has G = −5,000** on a second provider in that period, that
  provider pays 0 and the loss does **not** reduce the 10,000 above (per-provider,
  no carry-forward). This is the "company can pay out more than players lost"
  risk the file flags (**Q-02**).

---

## 2. Architecture

```
                ┌───────────────────────┐   ┌────────────────────────┐
 Players ──────▶│ Web (Next.js)          │   │ Telegram Mini App       │
                │ storefront per agent   │   │ (same components)       │
                └──────────┬────────────┘   └───────────┬────────────┘
 Agents / Staff ──▶ Agent dashboard · Admin back office  │
                           │  HTTPS (JSON, RBAC)         │
                ┌──────────▼─────────────────────────────▼────────────┐
                │ API (NestJS, TypeScript strict)                      │
                │  modules: config · health · ledger · users/agents ·  │
                │  auth(telegram) · deposits · withdrawals · providers │
                │  (adapter per provider) · settlement · audit · admin │
                └───┬────────────────────┬───────────────────┬────────┘
                    │                    │                   │
              PostgreSQL            Redis + BullMQ      Provider callbacks
        (ledger, users, audit,   (jobs: SLA escalation,   (bet/win/rollback,
         settlement; migrations)  settlement runs, alerts)  signed, idempotent)
```

Key design choices:

| Choice                                                                                                                                                                                                           | Why                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ledger core is plain TypeScript + SQL, not tied to NestJS** (`src/ledger/core`)                                                                                                                                | It's the money heart. It must be testable alone, and it survives any framework change.                                                                               |
| **Postgres enforces the money rules, not just the app.** A trigger blocks `UPDATE`/`DELETE` on ledger rows, a `CHECK amount > 0`, a unique idempotency key, and a non-negative balance checked under a row lock. | A bug or a manual SQL session can't silently rewrite history.                                                                                                        |
| **Journal + entries.** One `ledger_transactions` row (idempotency key, reason, reference) owns 1..n `ledger_entries` (debit account, credit account, amount).                                                    | A bet that's also a win, or a settlement payout to 5 beneficiaries, must post **atomically under one key**. Each entry row still carries every field listed in §5.1. |
| **Integer minor units (santim) as `BIGINT`**, `bigint` in TS                                                                                                                                                     | No floats, ever. 1 ETB = 100 santim.                                                                                                                                 |
| **Cached `account_balances`**, written only inside the ledger's posting transaction, with `rebuildBalances()` and `reconcile()`                                                                                  | §5.1 allows a reconcilable cache. Without it, every bet would need `SUM()` over history.                                                                             |
| **Config with effective dates** (`config_versions`)                                                                                                                                                              | Commission %, parent depth, SLA and rounding rule are all versioned, so settlement records which version it used.                                                    |
| **Feature flags table**, everything off by default                                                                                                                                                               | §8: unfinished-but-deployed features stay dark.                                                                                                                      |
| **Provider adapter interface**                                                                                                                                                                                   | Octhera first (the wallet protocol is already proven in YegaBet). Provider #2 doesn't touch core code.                                                               |

### Account model (§5.1)

Every account has `type`, `owner_kind` / `owner_id`, `currency = ETB`, and `allow_negative`.

| Account type          | Owner             | Can go negative?              | Meaning of a positive balance                   |
| --------------------- | ----------------- | ----------------------------- | ----------------------------------------------- |
| `PLAYER_WALLET`       | player            | no                            | Money the player can bet or withdraw            |
| `PLAYER_HELD`         | player            | no                            | Money held for a pending withdrawal             |
| `AGENT_CASH_POSITION` | agent             | **yes**                       | Negative = agent physically holds platform cash |
| `AGENT_PAYABLE`       | agent             | no                            | Commission owed to the agent                    |
| `PARENT_PAYABLE`      | agent (as parent) | no                            | Parent-level commission owed                    |
| `COMPANY_FLOAT`       | company           | **yes** (alert below minimum) | Funds winnings (§6)                             |
| `COMPANY_REVENUE`     | company           | no                            | The company's share                             |
| `PROVIDER_PAYABLE`    | provider          | yes                           | Owed to / from the provider for game results    |
| `PROVIDER_FEES`       | provider          | no                            | Provider-fee share from settlement              |

Balance convention: **balance = Σ credits − Σ debits** on that account. Every
entry adds +amount to one account and −amount to another, so **Σ of all balances
is always exactly 0**. That's the "debits = credits" invariant made testable.

---

## 3. Roadmap and how I'll run it

Order exactly as in CLAUDE.md §8. Each task gets `docs/plans/NN-*.md` →
build → tests → deploy → report.

| #     | Task                                                         | Depends on | Blocking open questions                                |
| ----- | ------------------------------------------------------------ | ---------- | ------------------------------------------------------ |
| 01    | Project setup                                                | —          | Q-10 stack, Q-11 hosting, Q-12 staging/prod, Q-13 repo |
| 02    | Ledger core                                                  | 01         | none (rules fully specified)                           |
| 03    | Users, roles, hierarchy, company agent                       | 02         | Q-01 depth (config, so not blocking)                   |
| 04    | Telegram registration + referral                             | 03         | Q-14 bot, Q-15 domain                                  |
| 05    | Deposits (manual)                                            | 02, 03     | Q-06 float vs agent cash                               |
| 06    | Withdrawals + SLA                                            | 05         | Q-06, Q-07                                             |
| 07    | First provider (seamless wallet)                             | 02, 03     | Q-16 which provider                                    |
| 08    | Agent onboarding workflow                                    | 03         | Q-17 who are cofounders/roles                          |
| 09    | Storefront multi-tenancy                                     | 08         | Q-15                                                   |
| 10    | Settlement engine                                            | 02, 07     | Q-01..Q-05, Q-09                                       |
| 11–16 | Dashboards, admin, limits, auto-verify, transfers, hardening | —          | Q-08 (RG limits)                                       |

### What I'm doing in this session (owner said "continue, park questions")

- ✅ Master plan (this file) and the open-questions register
- ✅ Plans 01 and 02
- 🔨 **Build + test 01 locally:** NestJS skeleton, config, health, logging, Prisma migrations, CI file, Dockerfile
- 🔨 **Build + test 02 locally:** full ledger core with unit, property, concurrency and invariant tests against a real Postgres
- ⛔ **Not doing:** any deploy, any remote push, any change to YegaBet. Deploy needs Q-11/Q-12/Q-13 answered, and §0 needs your sign-off per task.

---

## 4. Relationship to YegaBet (decided 2026-10-19)

This agent platform **is YegaBet**, and it **replaces** the old single-site
YegaBet web app. Its code lives in the yegabet repo under `agent-platform/`
as its own Node project (own package.json, database and CI). Until cut-over, the
old Next.js app keeps serving yega.bet unchanged. The brand stays config
(`PLATFORM_NAME=YegaBet`, `PLATFORM_DOMAIN=yega.bet`), not code.

Reuse **knowledge, not code**: the Octhera wallet protocol, signature checks and
late-bet edge cases from the old app go into the Task 07 adapter.

**Replacing the old app means migrating it** (players, balances, history) into the
ledger, with a cut-over. That is a new task (proposed **07b**, after the provider
wallet exists) with its own plan. Open questions M-01 to M-04.

---

## 5. Compliance reminders (§3)

- **Lawyer sign-off is not done** (as far as I know): betting operations, agent-held
  customer funds, and the multi-level revenue share in Ethiopia and under Telebirr /
  CBE / eBirr terms. I'll flag this again at Tasks 05, 06, 08 and 10.
- **No recruitment rewards anywhere.** The settlement engine only reads player bet
  results. There is no code path that pays for agent sign-ups.
