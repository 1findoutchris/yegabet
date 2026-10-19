# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

# ── Run ───────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS run
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/package.json ./package.json
USER app
EXPOSE 3000
# Migrations first (migration-based only, CLAUDE.md §4), then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
