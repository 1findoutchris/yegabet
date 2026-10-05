# Octhera (aggregator): API v2, company wallet

**Octhera's catalog is the site's catalog.** Everything on our Octhera account
is imported and organized into Casino and Games; the old `game_list/` games
are off the site (see [The catalog](#the-catalog)). **The sportsbook is not
part of this:** Sports is the original sportsbook, unchanged.

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
3. **Portal → Settings:** set the **Lobby URL** to `https://vinna.bet/casino`.
   This is where a game's exit/home button returns the player.
   (`/octhera` still works: it redirects to `/casino`.)
4. **Railway → vinnabet service → Variables:**

   | Variable | Value |
   |---|---|
   | `OCTHERA_API_KEY` | the API key from step 2 |
   | `OCTHERA_WALLET_SECRET` | the wallet signing secret from step 2 |
   | `CRON_SECRET` | already set; also guards `POST /api/cron/catalog-sync` |
   | `GAME_CATALOG` | leave unset. `legacy` = rollback to the old `game_list/` catalog |

   `OCTHERA_GAMES_PUBLIC`, `OCTHERA_AVIATOR_PUBLIC` and `OCTHERA_PAGE` only
   matter with `GAME_CATALOG=legacy`.

   Remove the old v1 variables: `OCTHERA_CALLBACK_SECRET` and
   `OCTHERA_TEST_USERS`.
5. **Portal → API keys → Test wallet:** it sends a signed ping. It should show
   **ok**. `INVALID_SIGNATURE` means `OCTHERA_WALLET_SECRET` doesn't match
   the portal.
6. **IP allowlist:** if you turn it on, add Railway's outbound IP, or every
   call returns 403.

### Is Octhera using the VinnaBet balance?

Play one small round, then look at Railway's logs for `[octhera-wallet]`:

| Log | Meaning |
|---|---|
| no `[octhera-wallet]` line at all | Octhera never called us, so it bet on its own balance. The portal's Wallet URL is missing or wrong, or the key isn't from the company wallet (v2) account. Fix steps 1–2 and run Test wallet. |
| `debit/bet … → ok balance=…` | Working: the bet came off the VinnaBet balance. |
| `→ INVALID_SIGNATURE (…)` | `OCTHERA_WALLET_SECRET` is missing or doesn't match the portal. |
| `→ INVALID_REQUEST (currency …)` | Octhera's currency isn't ETB. Set `OCTHERA_CURRENCY` to match the account, or change the account's currency. |

Each bet and win is also a `Transaction` row with reference `oc:debit:…` /
`oc:credit:…` on the player's admin page.

## The catalog

**Order matters:** set `OCTHERA_API_KEY` on Railway *before* deploying this.
Without it the game pages show "The game catalog isn't connected yet."

### Import

- The first page load imports Octhera's whole catalog (`GET /games`, 200 per
  page, every page until `total`) into the `catalog_games` table. After that
  it re-imports in the background once the last import is an hour old.
  `POST /api/cron/catalog-sync` with header `x-cron-secret: $CRON_SECRET`
  forces one and answers the counts.
- One row per Octhera `gameUid`, so re-imports update in place and nothing is
  duplicated, even when a game shows up on two pages.
- A game that disappears from Octhera is **deactivated** (row kept), but only
  after a complete import: if any page fails, nothing is taken off the site.
  It comes back if Octhera lists it again.
- Every import is logged in `catalog_syncs` (pages, `total`, games fetched,
  added, removed, counts per section, and any Octhera `type` we couldn't
  place). Railway logs show `[catalog] import: N from Octhera (…)`. If the
  log says `INCOMPLETE`, Octhera stopped paging early.
- Octhera down = the site keeps showing the last import.

### Backup of the old catalog

The first import copies the old catalog (every game in `game_list/`, with
whether it was shown) into `catalog_backups`, once. The files also stay in
the repo. Nothing in bets, transactions, tickets, favorites or recent games
is changed or deleted. Old tickets keep showing the old games' names.

### Sections

Each game's section and tab come from Octhera's `type`
(`src/lib/catalogClassify.ts`), then its name:

| Section | Tabs |
|---|---|
| **Casino** (`/casino`) | Slots, Live Casino, Table Games, plus Popular and New rails |
| **Games** (`/games`) | Crash & Instant, Fishing, Lottery & Keno, Arcade, More Games |
| **Sports** (`/sports`) | unchanged: the original sportsbook. Octhera games typed as sports are classified (`section = sports`) but never shown or launchable. |
| **Rewards** | unchanged: VinnaBet's own bonuses and promotions. Octhera's API has no rewards to import. |

- A type nothing matches goes to **Games → More Games** and is listed in the
  import log, so it can be mapped.
- Every section page filters by provider and game type, and has search. The
  lobby search covers every section and also matches provider names.
- Provider pages: `/casino/<provider>`. A provider we already had a page for
  keeps its address (e.g. `/casino/spribe`).
- Images: Octhera's `img`, else its `/media/games/<gameUid>` artwork.
- **Sports:** the original sportsbook (SportsPane, BetBy), exactly as before.
  Nothing in this catalog work changes it.
- Tapping a game opens it full-screen (Octhera's game URLs don't run inside
  the site's game window). Exit returns to the lobby.
- Old-catalog game ids are refused at launch ("no longer available").

### Rollback

Set `GAME_CATALOG=legacy` on Railway and redeploy: the old catalog and pages
come back exactly as before. The imported tables stay, unused.

## Playing a game (in-site player)

Tapping an Octhera game opens `/game/<gameUid>` on VinnaBet. The site header
stays on top, with a bar under it (Back, game name, Reload, Fullscreen), and
the game runs in an iframe that fills the rest of the screen. On phones the
bottom tab bar is hidden so the game gets the whole screen below the header.
The page asks `/api/games/launch` for a fresh single-use launch URL each time
it opens or reloads; the URL is never put in the page's HTML.

**This only works if Octhera lets vinna.bet frame its game pages.** If a
game shows the browser's grey "refused to connect" page, open the browser
console (F12) on `/game/...`: it names the header that blocked it.

- `Refused to display '…' in a frame because it set 'X-Frame-Options' to
  'deny'` (or `'sameorigin'`): Octhera must remove `X-Frame-Options` from
  its game/launch responses (it can't allow a single other site).
- `Refused to frame '…' because an ancestor violates the following Content
  Security Policy directive: "frame-ancestors …"`: Octhera must add
  `https://vinna.bet` (and `https://www.vinna.bet` if used) to
  `frame-ancestors`.

Ask Octhera to allow `https://vinna.bet` for **every** response in the chain,
the launch URL and any redirect or game-provider page it leads to. Nothing on
our side blocks the iframe; the site sends no CSP or X-Frame-Options.

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
- `src/lib/catalog.ts`: import, backup trigger, cached reads.
- `src/lib/catalogClassify.ts`: Octhera type → section and tab.
- `src/lib/legacyCatalog.ts`: the old `game_list/` catalog (backup, history
  names, rollback).
- `src/lib/games.ts`: the lists every page uses, from whichever catalog is on.
- `POST /api/cron/catalog-sync`: import now.
- `/api/games/launch`: `game_uid` `octhera:<gameUid>` (an active catalog
  game) launches through Octhera with the player's id and balance.
- `/game/[id]` (`src/app/(user)/game/[id]/page.tsx`) and
  `src/components/casino/OctheraPlayer.tsx`: the in-site player.
- `OctheraWalletTxn` (`octhera_wallet_txns`), migration
  `20261004120000_octhera_wallet_txns`. The old v1 `octhera_events` table is
  kept for history.
- Tables `catalog_games`, `catalog_syncs`, `catalog_backups`, migration
  `20261005090000_catalog_games` (new tables only).
- Tests: `tests/db/catalog.test.ts` (import, sections, launch),
  `tests/unit/catalogClassify.test.ts` (types, paging),
  `tests/db/octhera.test.ts` (wallet + launch),
  `tests/unit/octheraCatalog.test.ts` (legacy catalog mixing).
