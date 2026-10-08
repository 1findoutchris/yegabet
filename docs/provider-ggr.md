# Provider GGR

Admin → **Provider GGR** replaces the old *Silent GGR* page (its URL now
redirects here). For every game provider it shows Total Bet, Total Win, GGR,
the provider's fee %, the fee and the remaining GGR. Click a provider for its
details: rate history and breakdowns by game and by day.

Code: `src/lib/providerGgr.ts` (SQL + attribution), `src/lib/providerGgrCore.ts`
(arithmetic, tested in `providerGgrCore.check.ts` and
`tests/db/providerGgr.test.ts`), `src/app/api/admin/provider-ggr/*`,
`src/app/admin/[secret]/provider-ggr/*`.

## Where the numbers come from

Only our own wallet ledger (`transactions`), written by the three wallet
callbacks. Nothing comes from provider reports, and nothing is estimated.

| Integration | Rows | Stake / win | Voided by |
|---|---|---|---|
| Silent API (incl. BetBy sportsbook) | ref = Silent `serial_number` | `metadata.bet_amount` / `win_amount`; a round = all callbacks with the same `game_uid` + `game_round` | — |
| Gregmorn | `gm:<id>` | `metadata.bet` / `win` | `gm:<id>:rollback` |
| Octhera | `oc:debit:` / `oc:credit:` | debit `betAmount` (+`winAmount` for bet_win); credit `winAmount` only (its echoed `betAmount` is ignored) | `oc:rollback:<txnId>` |

- **Total Bet**: stakes of rounds that weren't rolled back.
- **Total Win**: what those rounds paid, including refunded stakes (a
  refunded round nets to 0 GGR).
- **Rolled-back** rounds are excluded from both and shown as "voided". The
  rollback rows themselves and agent `:commission` rows are never counted.
- **GGR** = Total Bet − Total Win, shown negative when players won.
- **Settled vs unsettled**: a round is settled when it has a payout, a
  settle/close callback, or `round_finished`. Casino rounds with no such event
  count as settled after 24 hours. Open sportsbook bets show under
  **Unsettled** and are not in GGR or fees.
- A round is dated by its **first event**, in `REPORT_TIMEZONE` (default
  Africa/Addis_Ababa). Events are read from 45 days before the range, so a late
  settlement is attributed to the day its bet was placed. Settlements arriving
  more than 60 days after a range are not reflected in it.
- **Currencies** are kept apart: one table per currency, never summed.

## Providers

The provider id is `<integration>:<provider>`, from each integration's own
catalog:

- `silent:<file>`: Silent's catalog is one file per provider (`game_list/`).
  Not `vendorCode`, because Silent reuses one vendorCode across providers.
- `gregmorn:<file>` from `game_list-gregmorn/`.
- `octhera:<providerCode>` from `catalog_games` (rows are never deleted).

A game none of these can place is shown as **Unattributed** for its
integration, never split between providers.

## Fees

Rates live in `provider_fee_rates` and are **append-only**. Each change is a
new row with percentage, negative-GGR policy, effective date, the admin who
made it, when, and a note. Each day is charged at the version in force that
day, so a change never silently recalculates earlier periods. An effective
date in the past is allowed only with a note, because it recalculates days
already reported.

A provider's own rate wins; otherwise the integration default
(`octhera:*` etc.) applies.

Negative-GGR policy, per agreement:

- `net_floor` (default): fee on net GGR; nothing owed when it's negative.
- `net_credit`: fee on net GGR; a negative GGR gives a negative fee (credit).
- `per_round`: fee on each house-won round, `max(bet − win, 0)`; player-won
  rounds never offset. This is Silent API's billing. The migration seeds
  `silent:* = 10% per_round` from 2000-01-01, so Silent figures match the old
  page.

Net policies are netted within the selected range (per rate version).

Only admins listed in `GGR_RATE_EDITORS` (default: `ADMIN_USERNAME`) can
change rates; the API answers 403 to anyone else.

## Historical gaps

- There is no data before each integration's first wallet callback.
- Silent callbacks without `game_uid`, or for games missing from the
  catalog files, show as **Silent · Unattributed**.
- Octhera games that never entered `catalog_games` show as
  **Octhera · Unattributed**.
- Provider attribution needs no new collection: every callback already stores
  the game id. The catalogs it maps through are kept: repo files, and catalog
  rows that are deactivated, not deleted.
