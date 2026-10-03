# Octhera (aggregator): Aviator test

A hidden test page, **`/octhera-test`**, launches **Spribe Aviator** through
Octhera. It isn't linked anywhere, and only accounts listed in
`OCTHERA_TEST_USERS` can use it. Everyone else sees "This page is not
available", and every API returns 404 for them. The rest of the site stays on
Gregmorn and BetBy.

## How the money works (different from Gregmorn)

Octhera runs the wallet. Each player has a balance on Octhera, funded in the
Octhera portal (Players → player → Deposit). Aviator plays against that
balance. Octhera sends a signed webhook for every bet, win, refund and
withdrawal step. We store them in `octhera_events` as a record.
**`User.balance` is never touched.**

Octhera's API has no deposit endpoint (deposits happen in the portal only),
so moving money between VinnaBet wallets and Octhera automatically isn't
possible with the current docs. That has to be solved before going beyond a
test.

## Setup

1. **Octhera portal → API keys:** create an API key and copy it. Copy the
   **callback secret**. Set the **Callback URL** to
   `https://vinna.bet/api/provider/octhera/callback`.
2. **Octhera portal → Settings:** set the **Lobby URL** to
   `https://vinna.bet/octhera-test`. Launches fail with "set lobbyUrl before
   launching games" until this is set.
3. **Railway → vinnabet service → Variables:**

   | Variable | Value |
   |---|---|
   | `OCTHERA_API_KEY` | the API key from step 1 |
   | `OCTHERA_CALLBACK_SECRET` | the callback secret from step 1 |
   | `OCTHERA_TEST_USERS` | your VinnaBet phone(s) or username(s), comma-separated, e.g. `+251911000000` |
   | `OCTHERA_AVIATOR_GAME_UID` | optional: Aviator's `gameUid`. Without it the server searches `GET /games?q=Aviator` for Spribe's Aviator |

   Removing `OCTHERA_TEST_USERS` turns the test off instantly.
4. **IP allowlist:** if you turn on Octhera's IP allowlist, add Railway's
   outbound IP, or every call returns 403.

## Aviator on the normal Games page

Set **`OCTHERA_AVIATOR_PUBLIC=true`** in Railway to show Aviator to **every
player**, as a normal game tile. It's first under **Popular Games** on the
Games page, and also appears in **Crash & Instant**, in search and on the
Spribe provider page. Tapping it opens Aviator through Octhera (`game_uid`
`octhera:aviator` in `/api/games/launch`), whatever `GAME_PROVIDER` is.
Remove the variable to hide it again.

- **Separate balance:** each player's Aviator balance lives at Octhera and
  starts at 0. You fund it by hand in the Octhera portal (Players →
  `vb_<user id>` → Deposit). When the game opens, the player sees a message
  with their Aviator balance, or that it's 0 and they should contact support.
- **Wins stay at Octhera:** they don't reach the VinnaBet balance
  automatically. Paying out means Octhera's withdraw flow plus a manual
  VinnaBet credit, until Octhera offers a deposit API to connect the wallets.
- **Artwork:** if you set `OCTHERA_AVIATOR_GAME_UID`, the tile uses
  Octhera's own image for it.

## Testing

1. Log in on vinna.bet with an account from `OCTHERA_TEST_USERS` and open
   `vinna.bet/octhera-test`.
2. Press **Play Aviator** once. This registers you on Octhera as
   `vb_<your user id>`, which the page shows.
3. In the Octhera portal, deposit test money to that player.
4. Play a few rounds. Each bet and win appears under **Webhooks received**
   within a few seconds, with Octhera's balance after it.

## Code

- `src/lib/providers/octhera.ts`: API client (register, balance, game
  lookup, launch), webhook signature check, tester list.
- `src/lib/octheraAccess.ts`: tester gate for the APIs.
- `POST /api/octhera/launch`, `GET /api/octhera/status`: tester-only.
- `POST /api/provider/octhera/callback`: the webhook. It verifies
  `x-octhera-signature`, stores the event, and ignores retries.
- `OctheraEvent` (`octhera_events`), migration `20261003120000_octhera_events`.
  Unique on (txnId, action), because Octhera's withdrawal examples reuse one
  txnId across steps.
- Tests: `tests/db/octhera.test.ts`.
