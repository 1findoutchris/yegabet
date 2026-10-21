# 12 · Player lobby in the old YegaBet design, with the agent's name by the logo

Status: **owner decision 2026-10-21 ("A, keep the old homepage design with agent name"). Building.**
The exclusions below were stated with option A and accepted.

## 1. Goal
Players get the familiar YegaBet lobby on the new platform: header with the
YegaBet mark, the **agent's name next to the logo**, search, illustrated
category tiles with game counts, rows of games (popular, crash, slots, live
casino, new, table games), provider tiles, footer. It's the same look as the old site
(its Tailwind design tokens, colours and category art are reused), running on
the new API and ledger. Agent and owner screens are unchanged.

## 2. Scope
**In**
- **Server:**
  - Each game gets a section/category with the old site's classifier (`classify`, ported with its rules)
  - `first_seen_at` for "New"
  - `GET /games` gains category / section / provider filters
  - `GET /games/lobby` returns category counts, provider counts and the rows in one call
  - "Popular" = most bets in the last 30 days
- **Screens** (player side, logged out too):
  - The lobby (`#/`), category pages (`#/c/<category>`), the Games section (`#/games`), provider pages (`#/p/<slug>`) and search
  - Header (logo + agent name, search, Log in / Join or balance + Deposit) and bottom nav
  - Playing, depositing and withdrawing need a login; browsing doesn't
- The old site's `tokens.css`, `CategoryArt` and `VMark`, with Tailwind v4 built into the web app (build time, no CDN, so the CSP stays strict)

**Not in** (stated with option A)
- **Sports / sportsbook:** no sports provider on the new platform
- **Rewards / XP / cashback / deposit bonuses / promo posters / ad pop-ups:** §3 forbids sign-up and recruitment bonuses, and the cashback rules aren't defined for the new platform
- **Favourites, "Jump back in", "Recommended for you":** after launch

## 3. Rules used
- §5.6 games come from the provider catalog
- §3 no bonuses
- §7 the CSP stays: Tailwind is compiled into our own CSS, no external styles or scripts

## 4. Data model (migration `0009_game_categories`)
`games`: + `section TEXT NOT NULL DEFAULT 'games'`, `category TEXT NOT NULL DEFAULT 'other'`, `first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()`; index (active, section, category). Existing rows are classified by the next catalog import (hourly; the job also runs at boot).

## 5. Money flow
None.

## 9. Test plan
- The classifier keeps the old site's rules: type and name cases, sports first, the unknown → other fallback
- Import stores section/category/first_seen_at
- `/games` filters; `/games/lobby` counts, providers, rows (no repeats across rows, sports never listed, popular from bets)
- 100% coverage of the new server code; the web app typechecks and builds

## 12. Definition of done
- [ ] Tests pass; deployed; the owner sees the lobby with the agent's name at `/?ref=<slug>`
