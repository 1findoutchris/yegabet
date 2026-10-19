# 05 · Deposits (manual verification first)

Status: **plan, awaiting owner approval.** ⚠️ Legal flag L-01: agents hold customer funds. The lawyer's confirmation is still open.

## 1. Goal

A player pays into **their agent's own** Telebirr / CBE Birr / eBirr account, then tells
us the amount and the transaction reference from their payment SMS. The agent checks
it against their own phone and confirms (or rejects). Staff can override. On
confirmation the ledger credits the player's wallet and records that the agent now
holds that cash for the platform. A reference can be used only once.

## 2. Scope

**In**

- Agent payment accounts (`agent_payment_accounts`): method, account name, account number. Added from the console for now (**Q-29**).
- Player: list my agent's accounts → submit a deposit → see my deposits
- Agent member: the queue of pending deposits for **their** agent → confirm / reject (with a reason)
- Staff with `deposits.override`: confirm or reject any pending deposit (logged as an override)
- Ledger posting on confirm, idempotent; duplicate references rejected
- Audit rows for submit / confirm / reject / override
- Feature flag `deposits.open` (**off** until launch)

**Not in**

- Automatic SMS matching (Task 14)
- Agent self-service for payment accounts and branding (Task 09)
- Deposit bonuses (§3: none)

## 3. Business rules used

- §5.7 "Player picks one of their agent's payment accounts, pays, submits the transaction reference."
- §5.7 "Verification: … **manual** (agent confirms; staff can override)."
- §5.7 "On verification: credit player wallet, debit agent cash position (agent now holds that cash for the platform)."
- §5.7 "Duplicate transaction references must be rejected."
- §2 Payments: "Telebirr, CBE Birr, eBirr; agent-owned accounts."
- §5.1 all ledger rules; §7 never log payment references in plain text.

**Open questions (answer before building)**

- **Q-27:** minimum and maximum deposit? **Answered: min 15 ETB, max 100,000 ETB** (config).
- **Q-28:** who may override (confirm/reject any deposit)? **Answered: owner only.**
- **Q-29:** who adds an agent's payment accounts before Task 09: staff from the console (proposal), or the agent?
- **Q-30:** how long may a deposit stay pending before it expires? **Answered: 24 h**, then it expires as "not confirmed".

## 4. Data model (migration `0005_deposits`)

```sql
agent_payment_accounts(
  id BIGSERIAL PK, agent_id → agents,
  method TEXT CHECK (IN ('telebirr','cbe_birr','ebirr')),
  account_name TEXT NOT NULL, account_number TEXT NOT NULL,   -- the agent's own number, shown to players
  active BOOLEAN DEFAULT true, created_at)
  UNIQUE (method, account_number)

deposits(
  id BIGSERIAL PK,
  player_id → players, agent_id → agents,         -- agent snapshot at submit time
  payment_account_id → agent_payment_accounts,
  method TEXT, amount BIGINT CHECK (amount > 0),   -- santim
  reference_hash TEXT NOT NULL,                    -- HMAC(method + normalized reference): uniqueness
  reference_enc TEXT NOT NULL,                     -- AES-GCM: shown to the agent who must match it
  status TEXT CHECK (IN ('pending','confirmed','rejected','expired')),
  decided_by_kind TEXT, decided_by_id TEXT, decision_reason TEXT, decided_at,
  ledger_transaction_id BIGINT,                    -- set on confirm
  created_at)
  UNIQUE (method, reference_hash)                  -- duplicate references refused, even after a rejection
  INDEX (agent_id, status), INDEX (player_id, created_at)
  trigger: status may only go pending → confirmed | rejected | expired, once
```

**Down:** drop both tables (destructive in prod: approval).

## 5. Endpoints

| Route                                                    | Who                                                           | What                                               |
| -------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| `GET /deposits/accounts`                                 | player                                                        | my agent's active payment accounts                 |
| `POST /deposits` `{paymentAccountId, amount, reference}` | player (active, not self-excluded), rate-limited              | creates a pending deposit                          |
| `GET /deposits`                                          | player                                                        | my deposits (reference shown masked: `****1234`)   |
| `GET /agent/deposits?status=pending`                     | agent member (`deposits.review.own`)                          | my agent's queue, with the full reference to match |
| `POST /agent/deposits/:id/confirm`                       | agent member of that agent, or staff with `deposits.override` | confirm → ledger                                   |
| `POST /agent/deposits/:id/reject` `{reason}`             | same                                                          | reject                                             |
| Job (hourly)                                             | system                                                        | pending older than 24 h (Q-30) → `expired`         |

## 6. Money flow

Only **confirm** moves money. It's one ledger posting:

| Debit                                       | Credit                       | Amount         | Idempotency key |
| ------------------------------------------- | ---------------------------- | -------------- | --------------- |
| `AGENT_CASH_POSITION` (the deposit's agent) | `PLAYER_WALLET` (the player) | deposit amount | `deposit:<id>`  |

**Worked example** (santim; 1 ETB = 100):

1. Player P (agent A) submits 500.00 ETB, ref `CHK12345`. Status pending. **No money moves.**
   Balances: A cash 0, P wallet 0.
2. Agent A confirms → posting `deposit:17`: A cash **−50,000**, P wallet **+50,000**. Σ = 0.
   Negative cash position = A holds 500 ETB of platform money (§5.7).
3. A clicks confirm again (double tap) → same key, replayed. Balances unchanged.
4. Another player submits ref `chk 12345` on Telebirr → **refused: reference already used** (normalized: upper case, no spaces).
5. A second deposit of 200.00 ETB is rejected by A as "no such payment". Nothing moves.
   Final: A cash −50,000, P wallet +50,000.

## 7. Edge cases

| Case                                                   | Handling                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Confirm and reject at the same moment                  | The row is locked (`FOR UPDATE`): the first wins, and the second gets "already decided"       |
| Confirm twice / network retry                          | Status is already confirmed → returns the same result; the ledger key replays anyway          |
| Agent confirms a deposit of another agent              | 403 (row scope: `agent_id` must equal their agent)                                            |
| Player's agent paused / player frozen or self-excluded | Submit refused. A paused agent's pending deposits can only be decided by staff override.      |
| Payment account deactivated after submit               | Can still be confirmed (the money may have arrived); new deposits can't pick it               |
| Amount 0, negative, decimals beyond santim, above max  | 400 before anything is written                                                                |
| Reference reused after a **rejection**                 | Still refused (it may be a retry of a fake). Staff can override-confirm the original instead. |
| Ledger posting fails on confirm                        | Same DB transaction as the status change, so the status stays pending and nothing moves       |

## 8. Security

- References are stored hashed (uniqueness) and encrypted (display), never logged. Masked for players, full for the deciding agent and staff.
- New permissions (proposal, Q-28): `deposits.review.own` (agent member), `deposits.override` (owner).
- Every decision writes an audit row: who, before/after status, amount, deposit id. No reference.

## 9. Test plan

- The worked example above, with exact balances after every step
- Duplicate reference (exact, different case/spaces, after rejection) → refused
- 20 parallel confirms → exactly 1 ledger posting; confirm vs reject race → one wins
- Agent B can't see or decide agent A's deposits; a player sees only their own; staff without override → 403
- Expiry job: a 25 h old pending deposit → expired; a 23 h one stays pending
- Self-excluded / frozen player → refused
- The status trigger blocks confirmed → pending, rejected → confirmed, etc.
- `ledger:check` ok after the suite; 100% coverage of `src/deposits/**`

## 10. Deployment

Additive migration, flag `deposits.open` off. After deploy: add one test payment account for a test agent (`is_test` ledger accounts), run a 1 ETB deposit end to end with the flag on for that test only, run `ledger:check`, then turn the flag off again.
**Rollback:** redeploy the previous image; leave the tables (empty).

## 11. Risks and assumptions

- Players type the reference by hand, so typos happen. The agent compares it with their SMS, and a mismatch is a reject.
- **L-01:** agents hold real customer money. This needs the lawyer's sign-off before real deposits are switched on.

## 12. Definition of done

- [ ] Q-27 to Q-30 answered
- [ ] All tests pass; 100% coverage of `src/deposits/**`; `ledger:check` ok
- [ ] Migration up/down tested; deployed; test deposit end to end on production
