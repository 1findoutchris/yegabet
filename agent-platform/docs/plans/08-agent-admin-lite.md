# 08 (lite) · Admin: create agents, members and staff

Status: **plan, awaiting owner approval.** The full application workflow (staff → owner → cofounder review, §5.3) comes after launch.

## 1. Goal

Let the owner set up the agent network from the admin instead of the server console:
create agents (with their immutable parent), pause or close them, add the people
who run each agent (agent members, by Telegram id), add staff with roles, and copy
each agent's referral links. Everything is audited. No money moves.

## 2. Scope

**In** (all owner-only, `agents.create` / `config.write`):

- `POST /admin/agents` `{slug, displayName, parentId?}`: Task 03's `createAgent`, so the parent is immutable, the path is computed by the DB, and the three ledger accounts are opened at 0
- `GET /admin/agents?search=&status=`: list with parent, depth, status, player count, member count, referral links
- `POST /admin/agents/:id/status` `{status: active|paused|closed}`
- `POST /admin/agents/:id/members` `{telegramUserId, displayName}` · `POST /admin/members/:id/status` `{active|disabled}`
- `GET/POST /admin/staff` `{telegramUserId, displayName, role}` · `POST /admin/staff/:id/status`
- `GET/POST /admin/flags` `{key, enabled}`: the launch switches (`signup.open`, `deposits.open`, `withdrawals.open`, `games.open`)
- `GET /public/info`: brand name, bot username, Mini App URL (for the screens)

**Not in:** the application form and the multi-step review (§5.3), storefront branding (Task 09).

## 3. Business rules used

- §5.2: the parent is set at creation and immutable; the company agent can't be a parent (Q-23).
- §3: creating an agent pays nothing (no recruitment rewards); no joining fee.
- Q-17 (owner, 2026-10-20): the company/owner confirms for now; roles per step later.
- Q-22: everyone logs in with Telegram, so a member or staff record is keyed by Telegram user id.

## 4. Data model

None new (Task 03 tables). `agents.status` already exists.

## 5. Referral links (returned with each agent)

- Telegram: `https://t.me/<bot>?start=<slug>`
- Website: `https://<PLATFORM_DOMAIN>/?ref=<slug>`

## 6. Money flow

None.

## 7. Edge cases

| Case                                                   | Handling                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate slug / Telegram id already a member or staff | 409                                                                                                                                         |
| Parent paused or closed / the company agent as parent  | 400 (DB trigger, Task 03)                                                                                                                   |
| Pausing an agent                                       | Their members' sessions stop working at once (Task 04); their players can't deposit or play (Tasks 05/07); open withdrawals go to the owner |
| Closing the company agent                              | Refused                                                                                                                                     |
| Owner disables themselves                              | Refused (last active owner)                                                                                                                 |

## 8. Security

Owner only. Every create/status change/flag change writes an audit row (before/after).

## 9. Test plan

Every route: happy path, permission refusal (support staff, agent member, player → 403), validation (400), duplicates (409), audit rows, last-owner protection. 100% coverage of the new admin module.

## 10. Deployment

No migration. Deploy, then the owner creates one test agent and checks the referral link opens the bot.

## 12. Definition of done

- [ ] Tests pass, 100% coverage of `src/admin/**`
- [ ] Deployed; the owner can create an agent + member from the admin
