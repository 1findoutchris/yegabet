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

## The /octhera page

**`vinna.bet/octhera`** shows **every game on our Octhera account**, for
everyone (logged out visitors see the games, and are asked to log in when they
tap one). It's on whenever `OCTHERA_API_KEY` is set. No other variable is
needed. Set **`OCTHERA_PAGE=off`** to hide it.

- Games play with the player's separate Octhera balance, and the page says so.
- If Octhera can't be reached, the page says "Octhera games aren't available
  right now" with the reason (for example `Octhera 401: …` = wrong API key,
  `Octhera 403: …` = IP allowlist).

## All Octhera games on the site

Set **`OCTHERA_GAMES_PUBLIC=true`** in Railway to add **Octhera's whole
catalog** to the site for every player. Remove the variable to hide them again.

- **Where they show:** in search, on provider pages, and in the Slots, Crash
  & Instant, Live, Hot and New lists. Octhera's game type decides the list
  (Slots, Crash/Instant, Live). A provider we already have, such as Spribe,
  joins its existing page (`/casino/spribe`). A new provider gets its own
  page under Octhera's provider name.
- **No duplicates:** if a game is already on the site from the main provider
  (same provider, same name), the existing tile stays. It plays with the
  VinnaBet balance. Octhera only adds the games we don't have yet.
- **Same separate balance as Aviator:** every Octhera game plays against the
  player's one Octhera balance. When a game opens, the player sees that
  balance, or that it's 0 and they should contact support.
- **Loading:** the list is fetched from Octhera (`GET /games`, page by page)
  when the server starts, then refreshed every hour. If Octhera can't be
  reached, the site keeps working without those games and tries again 5
  minutes later. Railway's logs show `[octhera] catalog loaded: N games`.
  Check that N matches the game count in the Octhera portal. The portal
  docs don't describe paging, so a low number means the paging guess needs
  adjusting.
- **Is it working?** Open `vinna.bet/octhera-test` with a tester account.
  The **All Octhera games on the site** box says whether the switch is on,
  how many games came from Octhera, how many are shown, and the last error
  if loading failed (for example a wrong API key, or a 403 from the IP
  allowlist).
- Launches use `game_uid` `octhera:<gameUid>`. Only games in the loaded
  catalog can be launched.

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
