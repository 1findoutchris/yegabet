# Vamos Bet — Project TODO

## ✅ Done
- [x] Next.js 16 + TypeScript + Tailwind + Outfit font
- [x] Prisma v5 schema (User, Transaction, Bet, Agent, Affiliate, Bonus, Session)
- [x] NextAuth v5 credentials provider (phone + password)
- [x] Silent API game launch endpoint (`/api/games/launch`)
- [x] Silent API wallet callback with HMAC-SHA256 timing-safe verification + idempotency
- [x] 85 game provider JSON files loaded (`src/data/games/`)
- [x] Casino dashboard with horizontal-scroll game rows (Hot, New, Slots, Crash, JILI, Live)
- [x] Dark casino UI — Fairspin-inspired layout
- [x] Collapsible sidebar (desktop) with icon-only collapsed mode + localStorage persist
- [x] Mobile responsive — bottom nav bar, slide-in drawer, 2-col game grid
- [x] Sports tab → BetBy iframe with auth gating
- [x] Login/Register popup modal (phone + password, show/hide, error states)
- [x] Auto-sign-in after registration
- [x] `LoginPrompt` on game card click (unauthenticated users)
- [x] `/api/auth/register` route with bcrypt hashing + username auto-generation

---

## 🔧 In Progress / Next Up

### Auth & User
- [ ] Show real balance from DB in Navbar (currently hardcoded "0.00")
- [ ] Sign out button (user avatar dropdown in Navbar)
- [ ] User profile page (`/profile`)
- [ ] Password change flow
- [ ] Phone OTP verification (integrate with Ethiopian SMS gateway, e.g. Afro Message)

### Wallet & Payments
- [ ] Deposit flow — integrate Ethiopian payment gateway (Telebirr, CBE Birr, HelloCash)
- [ ] Withdrawal request form + admin approval
- [ ] Agent deposit flow (SMS forwarder → `/api/agent/deposit`)
- [ ] Transaction history page (`/wallet/history`)
- [ ] Balance display refresh after game session ends

### Casino & Games
- [ ] Game search — live results as user types (search already wired, needs results dropdown)
- [ ] Individual game page or fullscreen iframe launcher (`/casino/play/[gameId]`)
- [ ] Category pages: Slots, Live Casino, Crash & Instant, Table Games (`/casino/[category]`)
- [ ] Providers filter — clicking a provider filters the game grid
- [ ] Favorite games (save to DB, show in sidebar)
- [ ] Recently played games section

### Sports
- [ ] Fix sports page auth: show BetBy iframe when logged in, landing page when not
- [ ] Sports-specific sidebar with live match list

### Promotions & Loyalty
- [ ] Daily rewards page
- [ ] Promotions page with bonus cards
- [ ] Loyalty tier display (Bronze → VIP progress bar)
- [ ] Welcome bonus on first deposit

### Admin Dashboard (`/admin`)
- [ ] Admin layout + auth guard (ADMIN/SUPERADMIN only)
- [ ] User list with search, filter, block/unblock
- [ ] Transaction overview + manual balance adjustment
- [ ] Deposit/withdrawal approval queue
- [ ] Game analytics (most played, revenue per game)
- [ ] Agent & affiliate management

### Agent Dashboard (`/agent`)
- [ ] Agent overview (commission earned, registered users)
- [ ] Deposit via SMS forwarder integration
- [ ] Player list under agent

### Infrastructure
- [ ] `DATABASE_URL` → Railway PostgreSQL production URL
- [ ] Run `npm run db:migrate` in production
- [ ] Deploy to Railway (web service + PostgreSQL)
- [ ] Set `NEXTAUTH_URL` to production domain
- [ ] Update `SILENT_API_CALLBACK_URL` to production domain
- [ ] Socket.io server deployment (separate Railway service)
- [ ] Environment variables in Railway dashboard
- [ ] Custom domain setup

### SEO & Performance
- [ ] `loading="eager"` on above-the-fold game images (LCP warning)
- [ ] Game image lazy loading optimization
- [ ] OG meta tags for social sharing
- [ ] Favicon + PWA manifest

---

## 🐛 Known Issues
- Register page (`/register`) returns 404 — now replaced by modal, old page routes can be removed
- Login page (`/login`) route still exists as a placeholder page — can be removed or kept as fallback
- Game rows show images from external CDNs with no optimization (using `unoptimized` prop)
- Sports iframe requires auth; guest browsing of odds not yet supported
