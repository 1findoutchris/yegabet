# ── Stage 1: Install all deps ──────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

# ── Stage 2: Build ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client for the target OS
RUN npx prisma generate

ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* is inlined at build time; Railway only passes service
# variables into a Docker build when they're declared as ARG.
ARG NEXT_PUBLIC_SPORTSBOOK_GAME_UID
ENV NEXT_PUBLIC_SPORTSBOOK_GAME_UID=$NEXT_PUBLIC_SPORTSBOOK_GAME_UID
RUN npm run build

# ── Stage 3: Production runner ─────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Static assets
COPY --from=builder /app/public ./public

# Next.js standalone bundle
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static

# Game data — read at runtime by src/lib/games.ts via fs
COPY --from=builder --chown=nextjs:nodejs /app/game_list ./game_list
COPY --from=builder --chown=nextjs:nodejs /app/game_list-gregmorn ./game_list-gregmorn

# Prisma schema (needed for migrate commands run via Railway CLI)
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs

# Railway injects $PORT; fallback to 3000
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Migrate then serve — npx fetches prisma@5 at boot (runner stage has no CLI).
# Schema is copied above; DATABASE_URL comes from the Railway Postgres plugin.
CMD ["sh", "-c", "npx --yes prisma@5 migrate deploy && node server.js"]
