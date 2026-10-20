# 07 · First provider: Octhera (seamless wallet) + bets with agent snapshot

Status: **approved 2026-10-20; built and tested locally (301 tests in total, 100% coverage of src/providers); deploy next. Octhera's Wallet URL switch is Day 3 (Q-36).**

## 1. Goal

Players play Octhera's games with their platform wallet. Octhera calls our
**Wallet URL** for every bet, win, refund and rollback (signed). We answer
within 3 s with the new balance, move the money in the ledger idempotently,
and store every bet with the **agent who owned the player at bet time**. That
record is what settlement (Task 10) reads. All of it sits behind a provider-adapter
interface, so provider #2 doesn't touch the core.

## 2. Scope

**In**

- `ProviderAdapter` interface (verify a callback, parse it, format answers) + the Octhera API v2 adapter
- `POST /providers/octhera/wallet`: `ping`, `debit` (bet / bet_win), `credit` (win / refund), `rollback`
- `bets` table: provider, player, **agent snapshot**, round, status `open | settled | rolled_back`, stake, win, settled_at
- Game catalog import from Octhera (`GET /games`, hourly) + `GET /games` for players
- `POST /games/:uid/launch` (player) → Octhera `POST /players/launch` → a single-use URL
- The open-bets check wired into withdrawals (§5.8) and ready for transfers (Task 15)
- Feature flag `games.open` (**off**)

**Not in**

- Exposure / payout caps (Task 13)
- Settlement maths (Task 10). This task only records the inputs.
- The game screens (Day 3)

## 3. Business rules used

- §5.6 "Providers call our API for bet, win, rollback, balance. Authenticate and sign/verify every callback. Idempotent by provider transaction ID. Handle retries, out-of-order delivery, and rollbacks."
- §5.6 "Store each bet with provider_id, player_id, **agent_id snapshot at bet time**, status (open/settled/rolled_back), settled_at, amounts."
- §5.6 "Build behind a provider-adapter interface so adding provider #2 does not change core code."
- §6 "Company float funds winnings; agents only earn revenue share."
- §5.1 all ledger rules.

**Open questions (answer before building)**

- **Q-34: which account do stakes and wins move against?** Proposal: **COMPANY_FLOAT** (bet: wallet → float; win: float → wallet), per §6. The provider's fee is then charged at settlement (Task 10), not per bet.
- **Q-35: when is a losing bet "settled"?** Octhera sends a credit for wins and refunds. If a losing round sends nothing, I propose a bet with no credit **24 h** after its round's last activity is settled as **lost**. I'll also check Octhera's docs; if they send a 0-amount credit for losses, we use that instead.
- **Q-36: move Octhera's Wallet URL from the old site to the new service** at go-live (Day 3)? The old site has no users, so the switch is safe. Proposal: yes, on Day 3.
- **Q-37: the new service needs its own Railway static outbound IPs** (they're per service) added to Octhera's IP allowlist. OK to enable them on the agent-platform service?

## 4. Data model (migration `0007_providers`)

```sql
providers(id TEXT PK, name TEXT, active BOOLEAN)            -- seeded: 'octhera'
provider_calls(                                              -- every wallet call, once per (provider, type, txn_id)
  id BIGSERIAL PK, provider_id, type TEXT, txn_id TEXT,
  player_id BIGINT, game_round TEXT, bet_amount BIGINT, win_amount BIGINT,
  applied BOOLEAN, response JSONB, payload JSONB, ledger_transaction_id, created_at,
  UNIQUE (provider_id, type, txn_id))
bets(
  id BIGSERIAL PK, provider_id, player_id, agent_id,         -- agent snapshot at bet time
  game_uid TEXT, game_round TEXT, debit_txn_id TEXT,
  stake BIGINT, win BIGINT DEFAULT 0,
  status TEXT CHECK (IN ('open','settled','rolled_back')),
  placed_at, settled_at,
  UNIQUE (provider_id, debit_txn_id))
  INDEX (player_id, status), INDEX (agent_id, provider_id, settled_at)   -- settlement reads this
games(provider_id, game_uid, name, type, img, active, synced_at, PK (provider_id, game_uid))
```

Each player's Octhera `playerId` is `yb_<player id>`, which never changes.

## 5. Endpoints

| Route                            | Who                                                          | What                                  |
| -------------------------------- | ------------------------------------------------------------ | ------------------------------------- |
| `POST /providers/octhera/wallet` | Octhera (signature `X-Octhera-Signature`, timestamp ≤ 300 s) | always HTTP 200 + `{status, balance}` |
| `GET /games?type=&provider=&q=`  | public                                                       | catalog                               |
| `POST /games/:uid/launch`        | player (active)                                              | launch URL                            |
| Job (hourly)                     | system                                                       | catalog import; Q-35 auto-settle      |

## 6. Money flow (santim; Q-34 answered: against the player's agent)

| Octhera sends                   | Ledger                                                                        | Bet row                         |
| ------------------------------- | ----------------------------------------------------------------------------- | ------------------------------- |
| `debit` bet, stake S            | `PLAYER_WALLET → COMPANY_FLOAT` S, key `octhera:debit:<txn>`                  | open, stake S                   |
| `debit` bet_win, stake S, win W | net in one posting: `W − S` towards the wallet (or `S − W` towards the float) | settled at once, stake S, win W |
| `credit` win / refund W         | `COMPANY_FLOAT → PLAYER_WALLET` W, key `octhera:credit:<txn>`                 | win += W, settled               |
| `rollback` of txn T             | reverse T's posting (ledger `reverse`)                                        | rolled_back                     |

**Worked example.** P has wallet 10,000 (100 ETB). P's agent is A.

1. Bet 20 ETB (round R1): wallet 8,000, A cash **+2,000**. Bet open, agent A.
2. Win 50 ETB on R1: wallet 13,000, A cash **−3,000**. Bet settled: stake 2,000, win 5,000.
3. Bet 30 ETB (R2), then Octhera rolls it back: wallet 13,000 again. Bet rolled_back.
4. The same win call retried: replayed, no change.
5. P moves to agent B (Task 15). Old bets stay with A: R1 still counts for A in settlement.

Settlement then sees, for agent A / Octhera: stakes 2,000, winnings 5,000, so G = −3,000. Nothing to split (§5.10).

## 7. Edge cases (from the old site's Octhera wallet, which works)

| Case                                       | Handling                                                       |
| ------------------------------------------ | -------------------------------------------------------------- |
| Retry of any call                          | Stored answer replayed (unique `(provider, type, txn)`)        |
| Bet with too little money / blocked player | `INSUFFICIENT_FUNDS` / `PLAYER_BLOCKED`, stored, nothing moves |
| Win for a round whose bet we never took    | `TXN_NOT_FOUND`, stored as unapplied; a retry is checked again |
| Late bet `<win txnId>:stake`               | Backs its win (old-site behavior, kept)                        |
| Rollback before the debit arrives          | Marker stored; the late debit gets `TXN_ROLLED_BACK`           |
| Bad signature / old timestamp              | `INVALID_SIGNATURE` (HTTP 200, per Octhera)                    |
| Currency not ETB                           | `INVALID_REQUEST`                                              |
| Must answer in < 3 s                       | One transaction, row locks, no outside calls in the path       |

## 8. Security

- Every wallet call is HMAC-verified (`OCTHERA_WALLET_SECRET`) with a timestamp window. The API key (`OCTHERA_API_KEY`) is only used for launch and the catalog.
- Launch URLs are single-use and never stored in pages.
- Bets and calls are append-only (trigger), except a bet's settle/rollback move.

## 9. Test plan

- The worked example with exact balances; every edge case above (most from the old site's tests)
- 20 parallel debits of one player → no overdraft; 20 parallel retries of one call → one posting
- Agent snapshot: a bet placed before a transfer stays with the old agent
- Signature: valid, wrong secret, old timestamp, two signatures during rotation
- The open-bets check blocks a withdrawal while a bet is open
- `ledger:check` ok; 100% coverage of `src/providers/**`

## 10. Deployment

Flag `games.open` off. New env vars: `OCTHERA_API_KEY`, `OCTHERA_WALLET_SECRET`. Static IPs (Q-37) go on the allowlist **before** Octhera's Wallet URL is switched (Q-36, Day 3).
**Rollback:** switch the Wallet URL back to the old site.

## 11. Risks and assumptions

- Q-34 is an accounting choice and affects settlement. It must be right before real money.
- Octhera's Wallet URL is per account: while it points at the new service, the old site's games stop working (fine, there are no users).

## 12. Definition of done

- [ ] Q-34 to Q-37 answered
- [ ] All tests pass; 100% coverage of `src/providers/**`; `ledger:check` ok
- [ ] Deployed; Octhera "Test wallet" → ok against the new service (on Day 3)

## 13. Build notes (2026-10-20)

- **Game money moves against the player's agent** (Q-34), not the company float: bet = wallet → agent cash position; win = agent cash position (**the bet's agent**, even after a transfer) → wallet.
- **Core and adapter are split:** `providers/gameWallet.ts` knows nothing about Octhera, and `providers/octhera/` verifies, parses and formats. Provider #2 = a new adapter folder.
- **The open-bet check is not added to withdrawals.** Stakes already leave the wallet when a bet is placed, so a withdrawal can never take money that's in play. Blocking withdrawals until rounds settle (up to 24 h) would only hurt players. The check (`GameWallet.openBets`) is ready for player transfers (Task 15), where §5.9 requires it.
- **A rollback of a `bet_win` the player already spent** takes only what's in the wallet and records the shortfall on the call (`shortfallSantim`) for reconciliation. The old site did the same.
- **A late-bet-backed win** (no stake taken) is recorded as a bet with stake 0, so settlement sees the winnings.
- **Raw request body:** the app now keeps it (`rawBody: true`), because Octhera signs the exact bytes.
- **Octhera playerId** = `yb_<player id>`.
