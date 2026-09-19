# In-Person Betting Agents (Retail Cashiers)

A new user role — `IN_PERSON_AGENT` — for shop cashiers who place sportsbook
bets on behalf of walk-in customers against printed tickets.

## The model

The agent is a **normal `User` row** with `role = IN_PERSON_AGENT` and a
`commissionRate` (percent of each stake, set by admin). He logs in with the
normal phone + password credentials flow, deposits and withdraws through the
existing user rails — the only differences are the restricted UI and the
ticket machinery.

```
customer walks in → agent opens ticket draft (name + phone)
→ places bet in the BetBy iframe (his own balance is debited)
→ wallet callback attaches the BET transaction to the open ticket
→ agent issues + prints the ticket (code T-XXXXXX)
→ win settles via callback → ticket flips to WON
→ customer returns → agent verifies name/phone → pays cash → marks PAID + receipt
```

## Schema (migration `20260919181004_in_person_agent`)

- `Role.IN_PERSON_AGENT` — new enum value
- `User.commissionRate` — Decimal(5,2), NULL for non-agents
- `User.agentTickets` — relation to Ticket
- `Transaction.ticketBet` — set when a BET/WIN row belongs to a ticket
- **`Ticket`** — `publicId` (T-XXXXXX), `agentId`, `customerName`,
  `customerPhone`, `status`, `totalStake`, `totalWin`, `paidAt`, `proofKey`
- **`TicketBet`** — links `ticketId` ↔ `transactionId`, stores `gameRound`,
  `betAmount`, `winAmount`, `settled`

Ticket status: `OPEN` (draft) → `PLACED` (issued) → `WON`/`LOST` (all bets
settled) → `PAID` (agent paid out). `CANCELLED` for voided empty drafts.

## Money flow — important

**A ticket never moves funds.** The money truth stays in `Transaction`:

- Agent's bet → normal `BET` transaction, his balance debits via `settleRound`
- Customer's win → normal `WIN` transaction, credited to the AGENT's balance
- Commission → separate `COMMISSION` transaction (`reference = serial:commission`),
  credited to the agent's withdrawable pot on every bet placed
- Agent's cash collections/payouts happen physically — the platform only sees
  the wallet side

## Callback hooks (`src/app/api/provider/wallet/callback/route.ts`)

Inside the same atomic transaction as the wallet update:

- `bet_amount > 0` → `attachBetToOpenTicket` links the new BET txn to the
  agent's single OPEN ticket (creates `TicketBet`, bumps `totalStake`)
- `win_amount > 0` (pure win) → `settleTicketBet` finds the `TicketBet` by
  `game_round`, records `winAmount`, refreshes ticket status
- `commissionAmt > 0` → extra `COMMISSION` transaction + balance credit

Non-agents are untouched — every hook is gated on `role === "IN_PERSON_AGENT"`.

## APIs

Agent (session + `IN_PERSON_AGENT` role, via `requireInPersonAgent`):

| Route | Purpose |
|---|---|
| `POST /api/agent/tickets` | open draft `{customerName, customerPhone}` — one open per agent |
| `GET /api/agent/tickets?search=` | list + search by code/name/phone |
| `GET /api/agent/tickets/[id]` | detail with bets (print view source) |
| `POST /api/agent/tickets/[id]/issue` | OPEN → PLACED (or WON/LOST if settled) |
| `POST /api/agent/tickets/[id]/pay` | WON → PAID, multipart `file` → S3 `proofKey` |
| `POST /api/agent/tickets/[id]/cancel` | void an empty OPEN draft |
| `GET /api/agent/stats` | commission earned, wallet, ticket totals |

Admin (`requireAdminAuth`):

| Route | Purpose |
|---|---|
| `GET /api/admin/in-person-agents` | list with stats (tickets, staked, commission, pending withdrawals) |
| `POST /api/admin/in-person-agents` | create — `{name, phone, commissionRate}` → returns generated username + password ONCE |
| `GET /api/admin/in-person-agents/[id]` | detail: profile, tickets, transactions |
| `PATCH /api/admin/in-person-agents/[id]` | update commissionRate / isActive / name |

## UI

- `(user)/layout.tsx` — `auth()` role check swaps the casino chrome for
  `AgentShell` (sidebar: Sports / Tickets / Stats / Deposit / Withdraw).
  `SportsPane` stays mounted; `agentMode` prop adjusts its offsets.
- `AgentTicketPanel` — bottom bar on `/sports`: open draft, watch bets attach
  (4s poll), issue & print, cancel.
- `/agent/tickets` — history + search. `/agent/tickets/[id]` — detail +
  printable ticket (`?print=1` auto-prints) + mark-paid with receipt upload.
- `/agent/stats` — commission, balance, ticket totals.
- Admin: `/admin/[secret]/in-person-agents` (+ `[agentId]` detail) — sidebar
  link "In-Person Agents".

## Route guard

`AgentShell` client-side redirects agents off any path outside
`/sports`, `/agent`, `/deposit`, `/withdraw`, `/withdrawals`. The APIs enforce
the role server-side regardless — the UI guard is convenience, not security.

## Known limits / deliberate omissions

- **No locked reserve** — winnings credit the agent's withdrawable balance
  directly (per client decision; the escrow design is documented in chat
  history if needed later).
- **Bet details** (teams/odds) don't come through the wallet callback — the
  ticket shows stake, code, status. The `data` payload field may carry more;
  verify against a real callback before promising slip detail on tickets.
- **One open draft per agent** — a second `POST /api/agent/tickets` returns
  409 until the first is issued or cancelled.
- **Local testing** — Silent API can't reach localhost; simulate the callback
  with an HMAC-signed POST (see below).

## Local test recipe

```bash
# 1. Create an agent (admin UI or SQL):
#    users.role='IN_PERSON_AGENT', commissionRate=3, isVerified=true

# 2. Open a ticket via the UI (/sports → New ticket) or API.

# 3. Fire a fake BET callback (signs with SILENT_API_SECRET_KEY):
node -e '
const crypto = require("crypto");
const body = JSON.stringify({
  serial_number: "TEST-" + Date.now(), currency: "ETB", game_uid: "betby",
  member_account: "AGENT_USERNAME", win_amount: "0", bet_amount: "1000",
  timestamp: new Date().toISOString(), game_round: "ROUND-1", data: null,
});
const sig = crypto.createHmac("sha256", process.env.SILENT_API_SECRET_KEY).update(body).digest("hex");
fetch("http://localhost:3001/api/provider/wallet/callback", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-signature": sig },
  body,
}).then(r => r.json()).then(console.log);
'

# 4. Issue the ticket, then fire a WIN with the same game_round:
#    win_amount: "2500", bet_amount: "0", game_round: "ROUND-1"
#    → ticket flips to WON, totalWin=2500, agent balance +2500 + commission
```
