# 04 · Telegram sign-up and login (players, agents, staff) + referral links

Status: **plan, awaiting owner approval.**

## 1. Goal

Everyone signs in with Telegram (Q-22). Players sign up by opening the YegaBet bot,
usually through an agent's referral link, and sharing their own Telegram contact.
That share is the proof the phone is theirs. They're then attached to the agent
from the link, or to the company agent. Logins from the Mini App and the website
are checked on the server with Telegram's signature, never trusted from the browser.
A successful login creates a short-lived session, which the Task 03 guard then uses.

## 2. Scope

**In**

- Bot webhook: `/start <agent_slug>` remembers the referral; a **"Share my phone"** button follows;
  a contact share registers the player (Task 03 `Players.register`)
- Login from the **Telegram Mini App** (`initData`) and the **website** (Telegram Login Widget)
- One Telegram identity, three possible roles: `player`, `agent_member`, `staff`. The login request says which.
- Sessions: an opaque random token stored **hashed**, 12 h lifetime, revocable (logout)
- An append-only **audit log** (§3): logins, failed logins, registrations, logouts. Created now, used by every later task.
- Rate limiting on auth routes (§7)
- An **18+ confirmation** at sign-up (§3 age hook; the minimum age stays config, Q-08)
- `npm run staff:add`: a one-off console command to create the first **owner** staff member (needs Q-25)
- Feature flag `signup.open`: **off** by default, so nobody can register before launch

**Not in**

- Website and Mini App screens (Day 3 basic screens). This task is the API they call.
- Agent onboarding / creating agents through the UI (Task 08). Until then agents are created from the console.
- Identity documents / KYC (only the hook)

## 3. Business rules used

- §5.5 "Verified phone via Telegram contact share. **Validate `initData` HMAC on the server; never trust the client for identity.**"
- §5.5 "New player gets `agent_id` from the referral link, else the company agent." "One account per verified phone number."
- §5.4 "Telegram deep link (`?start=agent_slug`) attaches a new player to that agent."
- §4 "Telegram `initData` signature validation on the server; sessions/JWT with short expiry; role-based access control."
- §3 age/identity hooks, append-only audit log; §7 rate-limit auth, never log phone numbers or tokens.

**Open questions (ask before building)**

- **Q-14:** which bot? I propose **reusing the existing YegaBet bot** (the one the old site uses for phone verification) and moving its webhook to the new service. There are no users, so the old site losing its bot is fine. Or should we make a new bot in @BotFather?
- **Q-24:** session lifetime 12 h (then the Mini App silently logs in again). OK?
- **Q-25:** your Telegram user id (for the first **owner** account). I'll tell you how to find it.

## 4. Data model (migration `0004_auth`)

```sql
sessions(
  id BIGSERIAL PK,
  token_hash TEXT UNIQUE NOT NULL,         -- sha256(token); the token itself is never stored
  principal_kind TEXT NOT NULL CHECK (IN ('player','agent_member','staff')),
  principal_id BIGINT NOT NULL,
  created_at, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
  ip TEXT, user_agent TEXT)

signup_intents(                             -- between /start and the contact share
  telegram_user_id TEXT PK,
  web_code_hash TEXT UNIQUE,                -- website hand-off code (hashed); NULL = started in Telegram
  player_id BIGINT,                         -- set when registration completes; status endpoint hands out one session
  consumed_at TIMESTAMPTZ,
  referral_slug TEXT,                       -- NULL = company agent
  age_confirmed_at TIMESTAMPTZ,
  created_at, expires_at TIMESTAMPTZ NOT NULL)   -- 30 min

audit_log(                                  -- append-only: trigger blocks UPDATE/DELETE
  id BIGSERIAL PK, at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_kind TEXT, actor_id TEXT,           -- NULL for anonymous (failed login)
  action TEXT NOT NULL,                     -- 'auth.login', 'auth.login_failed', 'player.registered', …
  target TEXT, before JSONB, after JSONB, ip TEXT)
players: + age_confirmed_at TIMESTAMPTZ
```

**Down:** drop the 3 tables and the column (destructive in prod: approval).

## 5. Endpoints

| Route                                            | Who                           | What                                                                        |
| ------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------- |
| `POST /telegram/webhook`                         | Telegram only (secret header) | `/start [slug]`, the 18+ button, contact share → register                   |
| `POST /auth/telegram/miniapp` `{initData, as}`   | public, rate-limited          | Verify initData (HMAC with the bot token, `auth_date` ≤ 24 h old) → session |
| `POST /auth/telegram/widget` `{id, …, hash, as}` | public, rate-limited          | Verify Login Widget hash (SHA-256 of the bot token) → session               |
| `GET /me`                                        | any logged-in principal       | who am I, my roles / agent                                                  |
| `POST /auth/logout`                              | logged-in                     | revoke the session                                                          |

`as` = `player` | `agent_member` | `staff`. If that Telegram user has no such record → 403 "no such account".
The session token comes back in the body (Mini App: `Authorization: Bearer`) **and** as an httpOnly, Secure, SameSite=Lax cookie (website).

### Sign-up flow (what a player sees)

1. Taps the agent's link `https://t.me/<bot>?start=<agent_slug>` (or the bot itself, which means the company agent).
2. The bot shows: "Welcome to YegaBet. Are you 18 or older?" with a **[Yes, I'm 18+]** button.
3. Then: "Share your phone number to create your account" with a **[Share my phone]** button.
4. Telegram sends the contact. We accept it only if `contact.user_id == from.id` (their **own** number).
5. The account is created and attached to the agent. The bot replies "Your account is ready", with an **[Open YegaBet]** button that opens the Mini App.

### Sign-up and login from the website

- **Login:** a "Log in with Telegram" button (Telegram Login Widget). Telegram confirms the user, and our server checks the widget hash (`POST /auth/telegram/widget`).
- **Sign-up:** phone proof must happen in Telegram (§5.5), so the site hands over to the bot and back:
  1. On `yega.bet/?ref=<agent_slug>` the player clicks **"Sign up with Telegram"**. The site calls `POST /auth/signup/start {ref}`, which returns a one-time code (15 min) and the deep link `t.me/<bot>?start=w_<code>`. The code carries the referral; Telegram's start payload allows 64 chars of `A–Z a–z 0–9 _ -`.
  2. In the bot: 18+ → share own contact → account created → **[Continue on website]** button.
  3. The page polls `GET /auth/signup/status?code=…` (rate-limited). Once the bot has finished, it gets a session exactly once, and the code is then used up.
- **No Telegram account = no sign-up.** This is a consequence of §5.5. SMS sign-up would be a rule change (asked as Q-26).

## 6. Money flow

**None.** Registration opens the two player accounts at 0 (Task 03). There are no sign-up bonuses (§3).

## 7. Edge cases

| Case                                     | Handling                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Contact of someone else (forwarded card) | Refused: "Please share your own number"                                                                     |
| Contact share without /start (no intent) | Treated as no referral → company agent, after the 18+ step                                                  |
| Referral slug unknown/paused             | Bot says the link isn't valid and offers signing up directly (company agent). It never silently re-assigns. |
| Already registered (phone or Telegram)   | Bot says "You already have an account" and shows [Open YegaBet]                                             |
| Replayed / old initData                  | Refused if `auth_date` is older than 24 h or the hash doesn't match                                         |
| Telegram retries a webhook               | Idempotent: registering the same phone twice is refused by the unique index, and the bot answers the same   |
| `signup.open` flag off                   | The bot answers "Sign-ups open soon"; nothing is written                                                    |
| Brute force on login                     | 10 attempts / minute / IP on `/auth/*`, then 429                                                            |

## 8. Security

- The bot token and webhook secret are env secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`). The webhook rejects calls without the secret header.
- Session tokens: 32 random bytes; only sha256 stored. Logs redact `authorization`, `cookie`, `initData`, `phone` (already in the Task 01 redact list).
- Every login/logout/registration/failed login writes an audit row (no phone, no token).
- Staff/agent logins need an **active** staff/agent-member row; disabled → refused.

## 9. Test plan

- **initData:** valid → ok. Tampered field, wrong bot token, missing hash, `auth_date` 25 h old → refused. (Tests use a fixed fake token and compute real signatures.)
- **Login Widget hash:** the same four cases.
- **Webhook:** wrong or missing secret → 401. `/start agent-b` then 18+ then own contact → player attached to agent B, with a `player.registered` audit row. Someone else's contact → refused, no player. Unknown slug → message, no player. Flag off → nothing written. Same update twice → one player.
- **Sessions:** login → `/me` works. After expiry → 401. After logout → 401. Token stored only as a hash.
- **Roles:** the same Telegram id as player and as staff (owner) → `as=staff` gives staff permissions, `as=player` gives player only. A disabled staff member is refused.
- **Website hand-off:** `signup/start` with ref B → `/start w_<code>` in the bot → contact → `signup/status` returns a session **once**; a second call → used up; an expired code → refused; a wrong code → pending/unknown with no information leak.
- **Rate limit:** the 11th attempt within a minute → 429.
- **Audit log:** UPDATE/DELETE rejected by the DB.
- Coverage: 100% of `src/auth/**`.

## 10. Deployment

1. New env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`.
2. Deploy (additive migration).
3. Point the bot's webhook at `https://<agent-platform domain>/telegram/webhook` with the secret (a script prints the exact command, like the old `telegram-setup.mjs`).
4. In @BotFather: `/setdomain` = the website domain (needed for the Login Widget).
5. `npm run staff:add` in the Railway console → your owner account.
6. Smoke test: `/start` in the bot with the flag **off** → "Sign-ups open soon". Then turn the flag on for a test, register yourself, log in, `/me` shows you, logout.

- **Rollback:** point the webhook back to the old site and redeploy the previous image.

## 11. Risks and assumptions

- Reusing the YegaBet bot (Q-14) means the old site's Telegram features stop when the webhook moves. This is acceptable because there are no users (Q-18).
- In-memory rate limiting works for 1 replica. Moving it to Redis is noted for Task 16 / multiple replicas.

## 12. Definition of done

- [ ] All tests pass; 100% coverage of `src/auth/**`
- [ ] Migration up/down tested
- [ ] Deployed; webhook set; smoke test above passes on production
- [ ] Your owner account works (`/me` shows `staff` + `owner`)
