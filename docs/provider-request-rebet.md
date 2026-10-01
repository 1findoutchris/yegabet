# Provider request: one-click "Bet this ticket"

**To:** Gregmorn Hub (sportsbook: BetBy, game `nova:sports-betby:sports`)
**From:** VinnaBet
**Purpose:** let our in-person (retail) agents re-bet a customer's previous
ticket with current odds, without rebuilding the bet slip by hand.

## What we have today

- We launch BetBy through `POST /games/openGame` and show the returned URL in
  an iframe.
- Bets are placed inside that iframe. We learn about them from the wallet
  callback. Its `info.detail.legs[]` carries display text only: `team1`,
  `team2`, `sport`, `tournament_name`, `market_type_name`,
  `outcome_display_name`, `coeficient`, `handicap`, `base`, `start_ts`.

So today our agents re-enter the old selections by hand, and our app checks
them off as the new bet arrives (see `docs/in-person-agents.md`).

## What we need (any one of these unlocks the full feature)

1. **Stable ids in the bet callback legs.** For each leg: `event_id`,
   `market_id`, `outcome_id` (and the specifier/line). Without them we can only
   match legs by display text.
2. **Bet-slip prefill on launch.** A parameter on `openGame` (or the iframe
   URL, or a `postMessage` API into the iframe) that opens BetBy with given
   outcomes already in the slip, e.g. `betslip=[{event_id, outcome_id}, …]`.
   The player still enters the stake and confirms in BetBy, so odds and market
   checks stay with BetBy. **This is our preferred option.**
3. **Read-only odds / event state API.** Given event + outcome ids, return:
   current odds, market status (open/suspended/closed), event status
   (not started/live/finished/cancelled) and start time. This lets us show an
   accurate "available / odds changed / closed" check before the agent places
   the bet.

Option 2 needs option 1, so the slip can be built from a previous ticket.

## Questions

- Does the BetBy integration under Gregmorn support `bt-path` or any
  deep-link/slip parameters on the launch URL?
- Can extra fields be enabled in the callback `info.detail` for our sub-user?
- Is there an odds/event feed available to operators, and on what terms?
