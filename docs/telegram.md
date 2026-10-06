# Telegram bot + Mini App

Telegram is another **client** for VinnaBet, like the website and the native
apps. It uses the same backend, database, users, wallet, sportsbook, casino,
tickets and session cookie. There is no Telegram balance, no second wallet,
and no separate betting backend.

## What was there before

| Question | Answer |
|---|---|
| Frontend | Next.js 16 App Router (`src/app`), React 19, Tailwind 4 |
| Backend | The same Next.js app: route handlers in `src/app/api`, Prisma 5 → Postgres, Redis |
| Auth model | NextAuth v5, Credentials provider (phone + password), JWT session cookie. Every player API calls `auth()`. |
| Phone format | `users.phone`, unique, stored as E.164 `+2519XXXXXXXX` by the signup form. `normalizePhone()` in `lib/sms.ts` is the canonical parser. |
| Sessions | Stateless JWT cookie (NextAuth default 30 days, rolling). Admin / agent portals have their own Redis sessions. |
| Reuse the frontend? | Yes. The site is already mobile-first; the Mini App *is* the site, opened at `/tg`, plus a thin Telegram layer. |
| Telegram before this | Two bots: the **payout-agent** bot (`TELEGRAM_BOT_TOKEN` → `/api/telegram/webhook`) and the **player verification** bot (`TELEGRAM_VERIFY_BOT_*` → `/api/telegram/verify`) used for signup/reset phone checks. |

The player verification bot became the VinnaBet bot. The payout-agent bot is
untouched: its chats run an agent login, and `TELEGRAM_BOT_TOKEN` keeps
meaning that bot.

## Setup

1. In @BotFather, on the player bot (`TELEGRAM_VERIFY_BOT_USERNAME`):
   - `/setdomain` → `vinna.bet` (lets the Mini App open on our domain).
   - Optional: `/newapp` to get a `t.me/<bot>/<app>` direct link for sharing.
2. Railway variables (see `.env.example`): `TELEGRAM_VERIFY_BOT_TOKEN`,
   `TELEGRAM_VERIFY_BOT_USERNAME`, `TELEGRAM_VERIFY_WEBHOOK_SECRET` (already
   set if the verification rail is on), plus the optional
   `TELEGRAM_WEBAPP_URL` (default `https://vinna.bet/tg`) and
   `TELEGRAM_SUPPORT_URL`.
3. Deploy. The migration `20261007090000_telegram_link` is additive (five
   nullable columns + a unique index) and runs with `prisma migrate deploy`.
4. Register webhook, commands, menu button and descriptions:
   ```
   node --env-file=.env scripts/telegram-setup.mjs
   ```
   It refuses non-HTTPS URLs and never prints the token. Re-run it any time.

Rollback: unset nothing. The signup verification flow works exactly as
before. To turn the new features off, point the menu button elsewhere (or
remove it in BotFather). The columns can stay.

## The bot

`/start` shows the menu: **Verify Phone Number · Open VinnaBet · Check Ticket ·
Support**. Commands: `/start` `/account` `/verify` `/ticket` `/help`, plus
`/unlink`. The menu button opens the Mini App.

Code: `src/app/api/telegram/verify/route.ts` (webhook), `src/lib/tgBot.ts`
(keyboards, copy), `src/lib/tgBotCore.ts` (pure parts).

- Webhook requests must carry `X-Telegram-Bot-Api-Secret-Token` (checked in
  constant time). Otherwise the response is 404.
- `update_id`s are remembered for 24h in Redis, so a retry is processed once.
- Only private chats are handled.
- When a **signup/reset verification** is pending for the chat, a shared
  contact belongs to it, exactly as before. Otherwise it's an account link.

## Phone verification and linking

`src/lib/tgLinkCore.ts` (decision table), `src/lib/tgLink.ts` (DB).

1. The bot asks with a `request_contact` button. A number typed into the chat
   is refused.
2. The contact counts only if `contact.user_id === message.from.id`.
   Forwarded cards and address-book entries are refused.
3. The number is normalized to E.164 and looked up, including legacy
   spellings (`0912…`, `2519…`). More than one match → refused, not guessed.
4. Linking writes only `telegramUserId`, `telegramUsername`,
   `telegramFirstName`, `telegramLinkedAt` and `telegramPhoneVerifiedAt`.
   Wallet, bets and password are not touched, and no user is ever created.
5. A link is never moved silently:
   - This Telegram is already linked to another account → "send /unlink first".
   - The account is linked to a different Telegram → refused (a recycled SIM
     must not take over Mini App sign-in). Support uses **Admin → user →
     Unlink Telegram**.
   - `telegramUserId` is `UNIQUE`; a race loses on the index.
6. Banned accounts and in-person agents (portal-only sign-in) can't be linked.

No account → "No VinnaBet account was found for this phone number." with
**Create Account** / **Try Another Account Method**.

## Mini App sign-in

```
Telegram ──initData──▶ /tg ──▶ POST /api/telegram/miniapp   (validate → linked?)
                           └──▶ signIn("telegram", {initData}) (validate again → user)
                                   └──▶ the normal NextAuth session cookie
```

- `src/lib/tgInitDataCore.ts` implements Telegram's spec:
  `secret = HMAC_SHA256("WebAppData", bot_token)`, hash over the sorted
  `key=value` lines, constant-time compare. It also rejects repeated keys and
  checks `auth_date` freshness (1 hour, 60 s future skew).
- The server never reads a user id, phone, wallet or account id from the
  client. The sign-in schema accepts only `initData`, and the page never
  reads `initDataUnsafe`.
- Telegram sessions expire after **12 hours** (fixed deadline in the JWT; the
  `jwt` callback returns `null` after it, which clears the cookie). The Mini
  App signs in again silently every time it opens. Password sessions are
  unchanged.
- No secrets in URLs. initData travels in POST bodies; the deep-link
  parameter is only a screen name.

Unlinked users see **Connect your VinnaBet Account → Verify Phone via
Telegram**. That calls `WebApp.requestContact()` (older clients: open the bot
chat). Telegram posts the contact to the bot, the webhook links it, and the
page polls `/api/telegram/miniapp` and then signs in. A failed link (e.g. no
account) is reported back to the page within the poll.

## Mini App UI

`/tg` (`src/components/telegram/MiniApp.tsx`) is the entry and Home screen:
wallet (real balance from `BalanceContext`), Deposit/Withdraw, and tiles for
Sports, Casino, Games, Live, Bet history, Check Ticket, Casino history and
Rewards. Everything else is the existing pages.

`TelegramBridge` (mounted in `Providers`, inert outside Telegram):
- loads `telegram-web-app.js` only inside Telegram,
- sets Telegram's header/background to VinnaBet navy,
- calls `expand()` and `disableVerticalSwipes()` (so scrolling a game doesn't
  close the app),
- maps Telegram's BackButton to in-app history,
- routes off-site links through `openLink` / `openTelegramLink`.

Inside Telegram, the bottom bar shows Home instead of Live, and the
install-the-app banner and the "join our channel" button are hidden.

## Deep links

`t.me/<bot>?startapp=<param>` (or `/start <param>` in the bot, or
`?to=<param>` on a bot button). `src/lib/tgStartCore.ts` is a strict
allow-list that only produces paths on our own site:

| Param | Opens |
|---|---|
| `ticket_T3F9K2A` | `/check?code=T3F9K2A` |
| `game_<uid>` | `/game/<uid>` |
| `promo_<id>` | `/rewards/bonuses` |
| `event_<id>` | `/sports` (the sportsbook iframe has no event deep link) |
| `sports` `casino` `live` `games` `wallet` `deposit` `history` `check` `rewards` `account` `profile` | that section |

A deep link only picks the first screen. Every action on it is still
authorized by the session.

## Games and sportsbook in Telegram's WebView

Telegram's WebView is the platform engine (Android System WebView, iOS
WKWebView), so iframes behave as in mobile Chrome/Safari, where Octhera games
and the sportsbook already run. The Octhera integration was not changed.

A provider page that refuses framing still fires the iframe's `load` event,
so a block can't be detected from our side. Inside Telegram, the game bar
therefore gets an **Open in browser** button, also shown on the "taking
longer than usual" panel. It requests a **fresh** single-use launch URL and
opens it with `WebApp.openLink`. The game still settles against the same
VinnaBet wallet, because providers call our wallet URL server-to-server.

Known limits:
- **web.telegram.org** runs Mini Apps in an iframe, where the `SameSite=Lax`
  session cookie isn't sent. The mobile and desktop apps are unaffected.
  Relaxing the cookie to `SameSite=None` for everyone would weaken CSRF
  protection on the main site, so it was not done.
- The barcode scanner on Check Ticket needs camera permission in the WebView.
  If denied, it says so and code entry still works. Telegram's own
  `showScanQrPopup` reads QR codes only, not the Code 128 on tickets.

## Tests

- `tests/unit/telegram.test.ts`: initData (including an independently
  computed known answer, tampering, freshness), contact proof, the link
  decision table, the deep-link allow-list, command parsing, ticket text.
- `tests/db/telegramLink.test.ts`: webhook auth and dedupe, linking end to end
  (wallet untouched, forwarded/typed numbers refused, no silent moves, signup
  verification still owns pending contacts), `/account`, `/ticket`, the
  Mini App status route and `telegramSignIn`.
