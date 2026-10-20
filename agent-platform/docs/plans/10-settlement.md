# 10 · Settlement engine: 10-day periods, draft statements, approval, cash netting

Status: **plan, awaiting owner approval.** ⚠️ L-01: the multi-level revenue share needs the lawyer's confirmation.

## 1. Goal

Every 10 days, for each agent and each provider, work out what the agent's
players lost (`G = stakes − winnings − payment fees`). If G is positive, split it
by the dated config. If G is zero or negative, nothing is split and the agent
carries it alone. The result is a **draft statement** per agent, which the owner
reviews and approves. Only then does the ledger move the non-agent shares out of
the agent's account. Approved statements are frozen. Anything that changes later
(a rollback, a late win) becomes an adjustment in the **next** period. Each agent
also gets a **cash-netting instruction**: remit X to the company, or the company pays you X.

## 2. Scope

**In**

- Periods: 10 days each, from the launch date (proposal; see Q-38)
- Dated split config + `max_parent_levels = 3`
- Draft computation (idempotent, re-runnable until approved), statements, approval (owner), ledger postings, the frozen record
- Adjustments for bets that change after they were counted
- Cash-netting instructions per agent (cash position + parent payable)
- An hourly job that drafts each period once it has ended
- Admin API (owner) + agent API (own statements)

**Not in**

- Paying out money (agents settle in cash; the ledger records the instruction)
- Payment fees: **0 until defined** (Q-03b)
- Screens (basic admin/agent screens come with the Day 3 UI work)

## 3. Business rules used (owner answers, 2026-10-20)

- **Split** (same for every agent, Q-04): agent **60**, company **10**, provider fee **10**, parent 1 **10**, parent 2 **5**, parent 3 **5**. A missing parent's share goes to the company (§2).
- **Per provider, no carry-forward** (§2, Q-02). **Losing periods are the agent's alone** ("the agent or owner handles it, we are not involved").
- **Game money already sits with the agent** (Q-34): players' losses landed in the agent's cash position, so settlement moves the **40% non-agent shares out of the agent**.
- **Refunds and payment fees are deducted before the split** (Q-03). Refunds are paid as winnings, so they reduce G automatically. Fees are 0 for now.
- **Rounding** (Q-09): each share floored to whole birr, the remainder to the company.
- **Approval:** the company (owner) confirms for now; roles later (Q-17).
- §5.10 all points: bets settled within the period, draft → review → approval, immutable once approved, adjustments next period, idempotent and re-runnable, periods lock, open bets roll forward.

**Open questions**

- **Q-38:** periods start at launch day 00:00 Addis Ababa time, every 10 days (proposal), or 1–10 / 11–20 / 21–end of month?
- **Q-03b:** payment fees: what they are and where their amounts come from (owner will confirm later; 0 meanwhile).

## 4. Data model (migration `0010_settlement`)

```sql
settlement_periods(id, starts_at, ends_at, status CHECK (IN ('open','draft','approved')),
  approved_by, approved_at, config_version_id → config_versions, created_at)
  UNIQUE (starts_at)

settlement_lines(                         -- one row per (period, agent, provider, beneficiary)
  id, period_id, agent_id, provider_id,
  stakes BIGINT, winnings BIGINT, fees BIGINT, result BIGINT,        -- G = stakes − winnings − fees
  beneficiary TEXT CHECK (IN ('agent','company','provider','parent')),
  beneficiary_agent_id BIGINT, parent_level INT,
  amount BIGINT, ledger_transaction_id)
  -- deletable/recomputable only while the period is draft (trigger); frozen once approved

settlement_counted(bet_id PK, net BIGINT, period_id)   -- what each bet has contributed so far

-- config (seeded): commission.split = {"agent":60,"company":10,"provider":10,"parents":[10,5,5]},
--                  settlement.max_parent_levels = 3, settlement.period_days = 10,
--                  settlement.first_period_start = <launch date>   (set at go-live)
```

**How a bet is counted (handles late changes cleanly):** for every bet that is settled or rolled
back by the period's end, `net_now = stake − win` (0 if rolled back). Its contribution this period
is `net_now − already_counted`. On approval, `settlement_counted` is set to `net_now`. So:

- A bet counted once never counts twice.
- A rollback after approval → a negative contribution next period.
- A late win → also negative next period.

Open bets contribute nothing until they settle.

## 5. Endpoints

| Route                                          | Who                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `GET /admin/settlement/periods`                | owner                                                               |
| `POST /admin/settlement/periods/:id/draft`     | owner: recompute the draft (only while draft)                       |
| `GET /admin/settlement/periods/:id/statements` | owner: every agent's statement + netting                            |
| `POST /admin/settlement/periods/:id/approve`   | owner: post to the ledger, freeze                                   |
| `GET /agent/statements`                        | agent member: own agent's approved statements + netting instruction |
| Job (hourly)                                   | ended `open` periods → `draft`                                      |

## 6. Money flow (only on approval)

For each agent × provider with G > 0, one ledger posting (key `settlement:<period>:<agent>:<provider>`):

| Debit                      | Credit                   | Amount                                      |
| -------------------------- | ------------------------ | ------------------------------------------- |
| AGENT_CASH_POSITION(agent) | COMPANY_REVENUE          | company share + remainder + missing parents |
| AGENT_CASH_POSITION(agent) | PROVIDER_FEES(provider)  | provider share                              |
| AGENT_CASH_POSITION(agent) | PARENT_PAYABLE(parent k) | parent k share, k = 1..3                    |

The agent's 60% doesn't move: it is already in their account.

**Worked example (owner checked, 2026-10-20).** Period 1, agent A, Octhera:
stakes 50,000.00, winnings (incl. refunds) 38,000.00, fees 1,234.57 → **G = 10,765.43 ETB**.

| Share           | %              | Exact     | Floored         |
| --------------- | -------------- | --------- | --------------- |
| Agent A (stays) | 60             | 6,459.258 | **6,459**       |
| Provider fee    | 10             | 1,076.543 | **1,076**       |
| Parent 1        | 10             | 1,076.543 | **1,076**       |
| Parent 2        | 5              | 538.272   | **538**         |
| Parent 3        | 5              | 538.272   | **538**         |
| Company         | 10 + remainder |           | **1,078.43**    |
| **Total**       | 100            |           | **10,765.43** ✓ |

Ledger on approval: A's cash −4,306.43 (= 1,076 + 1,076 + 538 + 538 + 1,078.43), credited to provider fees, P1–P3 and company revenue. Σ = 0.

- **A has only 2 parents:** the company gets 1,078.43 + 538 = **1,616.43**.
- **G = −3,000 on Octhera:** no lines with money, no posting; A already carried it.
- **Period 2:** a bet counted in period 1 (stake 1,000, win 0) is rolled back → contribution −1,000 to A's G in period 2.

**Cash netting** (per agent, after approval): A's cash position −20,000 (A holds platform money) → **"remit 20,000 ETB to the company"**. +3,000 → **"the company owes you 3,000"**. A parent's PARENT_PAYABLE (owed to them) is shown next to their own cash position, and the instruction is the net of both.

## 7. Edge cases

| Case                                        | Handling                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Draft recomputed twice                      | Same lines (deterministic); a draft is replaced, never added                              |
| Approve twice / retry                       | Ledger keys replay; the period is already approved → same result                          |
| Approve while bets settle in the background | Computed and posted in one transaction under a period lock, from a fixed `ends_at` cutoff |
| Config changes mid-period                   | The version in force at `ends_at` is used and recorded on the period                      |
| A parent closed / paused                    | Still credited (they earned it); the netting shows it                                     |
| Agent has open bets at period end           | They count when they settle, in the period of settlement                                  |
| G exactly 0                                 | Nothing posted                                                                            |

## 8. Security

`settlement.manage` permission (owner). Every draft/approve is audited. Agents see only their own statements; a parent sees children's **totals** only (Task 11).

## 9. Test plan

- The worked example to the santim; the 2-parent case; negative G; G = 0
- Refund counted as winnings; a rolled-back bet excluded; an open bet rolls forward
- An adjustment next period for a rollback and for a late win after approval
- Re-run draft = identical; approve twice = one posting; approved lines can't be edited (trigger)
- The config version is recorded; Σ ledger = 0 after approval; 100% coverage of `src/settlement/**`
- Property test: random bets across agents/trees, so Σ shares = Σ positive G per (agent, provider), and no share is negative

## 10. Deployment

Additive migration + config seed. `settlement.first_period_start` is set on launch day. **Rollback:** previous image (no approved period yet).

## 11. Risks and assumptions

- Agents carry losses alone and share gains. That's the owner's decision (Q-02/Q-34); explain it to agents in their agreement.
- Payment fees = 0 until defined; changing that later is a new config version and doesn't rewrite history.
- **L-01:** the multi-level revenue share needs the lawyer.

## 12. Definition of done

- [ ] Q-38 answered (or proposal accepted)
- [ ] All tests pass; 100% coverage; worked example exact
- [ ] Deployed; first period configured on launch day
