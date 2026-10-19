# 06 · Withdrawals: hold, agent pays, proof, confirmation, SLA escalation

Status: **plan, awaiting owner approval.** ⚠️ L-01 (agent-held funds) still open with the lawyer.

## 1. Goal

A player asks to withdraw. The money is **held** at once, so it can't be bet or
withdrawn twice. Their agent pays them from the agent's own Telebirr / CBE Birr /
eBirr (Q-06: withdrawals come from the agent's cash) and records the payment
reference as proof. When the player confirms they received it (or staff verify),
the hold is finalized and the agent's cash position goes down by that amount. If
the agent doesn't pay within the SLA (24 h), the request is escalated to staff.

## 2. Scope

**In**

- Player: request (amount + method), cancel while still unpaid, confirm received, report "not received"
- Agent member: queue of their agent's requests → **mark paid** (method + reference) or **decline** (with a reason)
- Staff with `withdrawals.override` (owner): complete, cancel or resolve any request, including escalated and disputed ones
- Ledger: hold on request, finalize on completion, release on cancel/decline
- SLA job: unpaid after 24 h → `escalated` (shown to staff). Paid but unconfirmed after **Q-33** → auto-complete.
- Audit rows for every step; feature flag `withdrawals.open` (**off**)

**Not in**

- Proof images (needs file storage; text reference first, **Q-32**)
- Open-bet checks: no bets exist until Task 07. The hook is in place, and Task 07 wires it in.
- Responsible-gambling limits (Task 13)

## 3. Business rules used

- §5.8 "Player requests, amount moves to **held**. Agent pays from their own account and uploads proof. Player confirms or staff verify; hold is finalized; agent cash position reduced. If the agent misses the SLA, auto-escalate to staff."
- §2 "Withdrawals: agent and platform both involved; timing undecided (configurable SLA, default 24h)."
- Q-06 (owner, 2026-10-19): **withdrawals are paid from the agent's cash.**
- §5.1 ledger rules; §7 rate limits, never log payment references.

**Open questions (answer before building)**

- **Q-06b:** a withdrawal **bigger than the platform cash the agent holds**. Example: the agent holds 1,000 ETB of deposits and a player wants 3,000.
  Until you answer, my proposal is: **allow it.** The agent pays 3,000 from their own money, their cash position goes **positive** (the platform owes the agent 2,000), and settlement (Task 10) nets it out. The alternative is to refuse or hold it. **You decide.**
- **Q-07:** minimum / maximum withdrawal? Proposal: min **50 ETB**, max **100,000 ETB**. SLA **24 h** (default in §2).
- **Q-31:** pay only to the player's **verified phone number** (the one Telegram confirmed at sign-up)? Proposal: **yes**. It stops fraud where a stolen session withdraws to someone else's number.
- **Q-32:** is a typed **payment reference** enough as proof for now? (Proposal: yes; screenshot upload later, with storage.)
- **Q-33:** if the agent marked it paid and the player never answers, auto-complete after how long? Proposal: **24 h**.

## 4. Data model (migration `0006_withdrawals`)

```sql
withdrawals(
  id BIGSERIAL PK, player_id → players, agent_id → agents (snapshot at request),
  method TEXT CHECK (IN ('telebirr','cbe_birr','ebirr')),
  amount BIGINT CHECK (amount > 0),
  status TEXT CHECK (IN ('requested','paid','completed','cancelled','declined','escalated','disputed')),
  paid_reference_hash TEXT, paid_reference_enc TEXT, paid_at, paid_by_id TEXT,
  hold_transaction_id, final_transaction_id → ledger_transactions,   -- unique each
  closed_by_kind TEXT, closed_by_id TEXT, close_reason TEXT, closed_at,
  sla_due_at TIMESTAMPTZ NOT NULL,                  -- requested_at + 24 h
  created_at)
  INDEX (agent_id, status), INDEX (player_id, created_at), INDEX (status, sla_due_at)
  UNIQUE (method, paid_reference_hash)               -- one payment proves one withdrawal
  trigger: only the allowed status moves (below); the request (player, agent, amount, method) is immutable; never deleted
```

Allowed moves:
`requested → paid | cancelled (player) | declined (agent) | escalated (SLA)`
`paid → completed | disputed`
`escalated → paid | completed | cancelled (staff)`
`disputed → completed | cancelled (staff)`

## 5. Endpoints

| Route                                                         | Who                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `POST /withdrawals` `{amount, method}`                        | player (active), rate-limited                                               |
| `GET /withdrawals`                                            | player (own)                                                                |
| `POST /withdrawals/:id/cancel`                                | player, while `requested`                                                   |
| `POST /withdrawals/:id/received` · `/not-received`            | player, while `paid`                                                        |
| `GET /agent/withdrawals?status=`                              | agent member (own agent); owner sees all                                    |
| `POST /agent/withdrawals/:id/paid` `{reference}`              | agent member (own), or owner                                                |
| `POST /agent/withdrawals/:id/decline` `{reason}`              | agent member (own), while `requested`                                       |
| `POST /agent/withdrawals/:id/complete` · `/cancel` `{reason}` | owner (escalated / disputed / any open)                                     |
| Job (every 15 min)                                            | `requested` past `sla_due_at` → `escalated`; `paid` past Q-33 → `completed` |

The response to the player shows **where** the money will go: their verified phone, masked (`+251****5678`), per Q-31.

## 6. Money flow (santim)

| Step                                      | Debit → Credit                        | Key                       |
| ----------------------------------------- | ------------------------------------- | ------------------------- |
| Request                                   | `PLAYER_WALLET` → `PLAYER_HELD`       | `withdrawal:<id>:hold`    |
| Complete (player confirms / staff / auto) | `PLAYER_HELD` → `AGENT_CASH_POSITION` | `withdrawal:<id>:final`   |
| Cancel / decline                          | `PLAYER_HELD` → `PLAYER_WALLET`       | `withdrawal:<id>:release` |

**Worked example.** Agent A's cash position is −50,000 (A holds 500 ETB of platform money). Player P's wallet is 50,000.

1. P requests **200.00 ETB**: wallet 30,000, held 20,000. A cash unchanged at −50,000. Σ = 0.
2. P immediately requests **400.00 ETB**: **refused**, because only 300.00 is left in the wallet.
3. A pays P 200 ETB on Telebirr and marks it paid with ref `TB998877`. **No ledger move** (the money moved outside, in Telebirr).
4. P taps "Received": held 0, **A cash −30,000** (A now holds 300 ETB of platform money). Wallet 30,000.
5. P requests 100 ETB, then cancels before A pays: wallet back to 30,000, held 0.

**Q-06b case (if "allow"):** A holds −30,000 and P2 withdraws 500 ETB. On completion, A cash = −30,000 + 50,000 = **+20,000**: the platform owes A 200 ETB, settled in Task 10.

## 7. Edge cases

| Case                                          | Handling                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Two requests at the same moment               | Each hold is a ledger posting under the wallet row lock, so the second one fails if the money isn't there |
| Agent marks paid twice / a retry              | Same reference → same result. A different reference on a paid withdrawal → refused.                       |
| One Telebirr ref used for two withdrawals     | Refused (unique per method)                                                                               |
| Player cancels after the agent marked it paid | Refused: the money may be on its way. "Not received" goes to staff instead.                               |
| Agent misses 24 h                             | `escalated`. Staff can still let the agent pay it, or complete/cancel it themselves.                      |
| Agent paused                                  | Their open requests go to staff; new requests are refused with a message                                  |
| Status change + money                         | One DB transaction with the row locked (like deposits), so no half-done step                              |

## 8. Security

- Paid to the verified phone only (Q-31), shown masked. The reference is hashed + encrypted, never logged.
- New permissions: `withdrawals.review.own` (agent member), `withdrawals.override` (owner).
- Every step is audited: who, before/after status, amount (no reference, no phone).

## 9. Test plan

- The worked example step by step with exact balances; the Q-06b case per the answer
- Races: 2 parallel requests > balance → one refused. Paid vs cancel race → one wins. 20 parallel "received" → one final posting.
- Every allowed and forbidden status move (DB trigger), plus the scopes (agent B ≠ agent A, players see only their own)
- SLA job: 25 h unpaid → escalated; 23 h stays. Paid 25 h without an answer → completed (if Q-33 = 24 h).
- `ledger:check` ok; 100% coverage of `src/withdrawals/**`

## 10. Deployment

Additive migration, flag `withdrawals.open` off, the same test-account smoke test as deposits. **Rollback:** previous image.

## 11. Risks and assumptions

- With Q-06b = allow, an agent can end up owed money by the platform until settlement. That's the agent's risk, and needs Task 10 to settle it.
- No proof image yet: disputes rely on the agent's reference and the player's word, so staff decide.

## 12. Definition of done

- [ ] Q-06b, Q-07, Q-31, Q-32, Q-33 answered
- [ ] All tests pass; 100% coverage of `src/withdrawals/**`; `ledger:check` ok
- [ ] Migration up/down tested; deployed; test withdrawal end to end on production
