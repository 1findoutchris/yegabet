# 11 (lite) · Screens: one web app for players, agents and the owner

Status: **approved 2026-10-20; built (341 tests pass; web typecheck + build ok; local server smoke test ok); deploying.** Not yet tried in a real browser or inside Telegram: that is the first check after deploy.

## 1. Goal

Give every role working screens on top of the API that is already live:

- **Players:** sign up, log in, wallet, deposit, withdraw, play games.
- **Agents:** deposit and withdrawal queues, payment numbers, statements.
- **The owner:** agents, switches, settlement, rules.

The same pages run inside Telegram (Mini App, auto-login) and in a normal browser (Telegram Login Widget).

## 2. Scope

**In**

- **Stack:** React + Vite + TypeScript, built into the API image and served at `/` by the same service (same origin, so the session cookie just works). No new project, no new Railway service.
- **Brand from config** (`PLATFORM_NAME`), YegaBet's orange & black theme, mobile-first, English.
- **Player pages:**
  - Login / sign-up (Mini App: automatic; web: "Log in with Telegram" + "Sign up with Telegram" hand-off)
  - Home: balance (available + held), game grid with search and type filter, play
  - Deposit: the agent's numbers → amount + reference → status list
  - Withdraw: amount + method, pays to the verified phone (shown masked) → status list with **Received / Not received**
  - Account: phone (masked), agent, logout
- **Agent pages** (login "as agent"):
  - Deposits queue: confirm / reject with reason
  - Withdrawals queue: the number to pay, **mark paid** with reference, decline
  - Payment numbers: add / deactivate
  - Statements + netting instruction
- **Owner pages** (login "as staff"):
  - Agents: create with parent, status, members, referral links (copy)
  - Switches: sign-ups / deposits / withdrawals / games on/off
  - Settlement: periods → statements → draft / **approve**
  - Rules: view and change any rule (with effective date)
- **Small API additions it needs:**
  - `GET /me/wallet` (player: available + held)
  - The Task 08-lite routes
  - Static file serving with an SPA fallback (unknown non-API paths → `index.html`)

**Not in:** parent child-summaries (Task 11 full), exports (Task 12), storefront branding per agent (Task 09), translations.

## 3. Business rules used

§5.11 dashboards (lite subset), §5.5 Telegram login only (validated on the server, already built), §7: the web app never sees secrets. It only calls the API, and the API enforces every rule.

## 4. Data model

None.

## 5. Routes

SPA routes: `/` (player), `/agent/*`, `/admin/*`, `/login`. API routes keep their paths, and the SPA fallback never shadows them.

## 6. Money flow

None in the UI. Every action is an existing, tested API call.

## 7. Edge cases

| Case                     | Handling                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| Session expired (12 h)   | Mini App re-logs in silently; web shows login                            |
| Feature switch off       | The API's 503 message is shown as "opens soon"                           |
| Game URL can't be framed | Open in a new tab / Telegram in-app browser                              |
| Slow network             | Loading states; buttons disabled while a request runs (no double submit) |

## 8. Security

- Same-origin cookie (httpOnly, Secure, SameSite=Lax).
- No tokens in localStorage for the web (cookie only). The Mini App keeps its token in memory.
- A CSP header allows only our own scripts + Telegram's `telegram-web-app.js` and login widget.

## 9. Test plan

- API additions: 100% coverage like every other module.
- Web: typecheck + production build in CI; component tests for the money forms (amount parsing, double-submit guard); a Playwright smoke run against a local server (login stubbed with a test session) covering the main flows: deposit submit → agent confirms → balance shows; withdraw → mark paid → received.

## 10. Deployment

- The Dockerfile builds the web app too.
- After deploy: BotFather `/setdomain` = the site domain (needed for the Login Widget); BotFather Mini App URL = `https://<domain>/`.
- **Rollback:** previous image.

## 11. Risks and assumptions

- Lite UI: plain but complete. Visual polish and per-agent branding come after launch.
- The Login Widget works only on the domain set in BotFather: the railway.app domain first, yega.bet at cut-over.

## 12. Definition of done

- [ ] All API tests pass; web builds; smoke run passes
- [ ] Deployed; the owner logs in as staff, creates an agent, a player signs up through the agent's link, and a test deposit → withdrawal works end to end with the switches on for that test

## 13. Build notes (2026-10-20)

- **Pages use `#/…` routes** (`/#/admin`, `/#/agent`), because `/admin` and `/agent` are API paths, and the Telegram webhook and API stay exactly where they are.
- **One login screen with Player / Agent / Staff tabs** (Telegram Login Widget). Inside Telegram the Mini App logs the player in automatically.
- **Every money button runs once at a time** (`useAction`), so a double tap sends one request. The server also refuses duplicates.
- **Security headers** on every response (`src/web.ts`): a CSP allowing only our scripts + telegram.org, framing only by Telegram, nosniff, referrer policy.
- **Not done (honest):** the planned Playwright smoke run. Instead: unit tests for the money/format helpers, an HTTP test that the app and its headers are served, and a local smoke run of the built server. The browser/Telegram run happens on the deployed site with the owner.
