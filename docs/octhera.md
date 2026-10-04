# Octhera (aggregator): API v2, company wallet

Octhera games play with the player's **normal VinnaBet balance**. Octhera
launches the game, then calls our **Wallet URL** before every bet and after
every win, and our database moves the money, just like the Gregmorn wallet.
No manual deposits in the Octhera portal.

## Setup

1. **Octhera portal:** use the **company wallet** account (API v2). Calls with
   a hosted-wallet (v1) key get 403.
2. **Portal → API keys:**
   - Create an API key and copy it.
   - Set the **Wallet URL** to `https://vinna.bet/api/provider/octhera/wallet`.
   - Copy the **wallet signing secret**.
3. **Portal → Settings:** set the **Lobby URL** to `https://vinna.bet/octhera`.
   This is where a game's exit/home button returns the player.
4. **Railway → vinnabet service → Variables:**

   | Variable | Value |
   |---|---|
   | `OCTHERA_API_KEY` | the API key from step 2 |
   | `OCTHERA_WALLET_SECRET` | the wallet signing secret from step 2 |
   | `OCTHERA_GAMES_PUBLIC` | optional: `true` also mixes Octhera games into the lobby, search and provider pages |
   | `OCTHERA_AVIATOR_PUBLIC` | optional: `true` puts Aviator first in Popular Games |
   | `OCTHERA_PAGE` | optional: `off` hides `/octhera` |

   Remove the old v1 variables: `OCTHERA_CALLBACK_SECRET` and
   `OCTHERA_TEST_USERS`.
5. **Portal → API keys → Test wallet:** it sends a signed ping. It should show
   **ok**. `INVALID_SIGNATURE` means `OCTHERA_WALLET_SECRET` doesn't match
   the portal.
6. **IP allowlist:** if you turn it on, add Railway's outbound IP, or every
   call returns 403.

## Where players find the games

- **`vinna.bet/octhera`** shows every game on the Octhera account, for
  everyone. It's on whenever `OCTHERA_API_KEY` is set. If Octhera can't be
  reached, the page shows the reason.
- With `OCTHERA_GAMES_PUBLIC=true`, Octhera games also appear in search, on
  provider pages and in the Slots / Crash & Instant / Live / Hot / New lists.
  A game the main provider already has (same provider and name) isn't
  shown twice.
- Tapping a game opens it full-screen (Octhera's game URLs don't run inside
  the site's game window). Exit returns to `/octhera`.

## How the money works

| Octhera sends | We do |
|---|---|
| `debit` (bet / bet_win) | Check `max(0, bet − win)` is available, apply `win − bet`, answer the new balance. Too little → `INSUFFICIENT_FUNDS`. Blocked account → `PLAYER_BLOCKED`. |
| `credit` (win / refund) | Add the win. Never refused, even for a blocked account. |
| `rollback` | Undo the debit with the same txnId. If the debit never arrived, remember the rollback, so a late debit gets `TXN_ROLLED_BACK`. |
| `ping` | Answer ok. |

- Every call is checked against `X-Octhera-Signature` (HMAC-SHA256 of
  `timestamp + "." + body` with the wallet secret). Calls whose timestamp is
  more than 5 minutes off are refused.
- Each (type, txnId) is processed once. A retry gets exactly the first
  answer. Parallel calls for one player are serialized with a row lock, so
  a balance can't be overdrawn.
- Money moves are normal `Transaction` rows (references `oc:debit:…`,
  `oc:credit:…`, `oc:rollback:…`), so they show in history and admin. Every
  call is also kept in `octhera_wallet_txns` with the answer we gave.
- Bets earn loyalty points and the daily streak, like other games.

## Code

- `src/lib/providers/octhera.ts`: API v2 client (catalog, launch) and the
  wallet signature check.
- `POST /api/provider/octhera/wallet`: the wallet.
- `src/lib/games.ts`: loads Octhera's catalog (hourly) for `/octhera` and
  the normal lists.
- `/api/games/launch`: `game_uid` `octhera:<gameUid>` (or `octhera:aviator`)
  launches through Octhera with the player's id and balance.
- `OctheraWalletTxn` (`octhera_wallet_txns`), migration
  `20261004120000_octhera_wallet_txns`. The old v1 `octhera_events` table is
  kept for history.
- Tests: `tests/db/octhera.test.ts` (wallet + launch),
  `tests/unit/octheraCatalog.test.ts` (catalog).
