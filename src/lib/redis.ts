import Redis from "ioredis";

const globalForRedis = global as unknown as { redis?: Redis };

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 3,
    // lazyConnect avoids opening a socket during the Next.js build; the first
    // command triggers the connect. enableOfflineQueue lets that first command
    // (and any issued during the handshake) wait for the connection instead of
    // throwing "Stream isn't writeable" — critical so a deposit/SMS right after
    // a cold start isn't dropped.
    lazyConnect: true,
    enableOfflineQueue: true,
  });

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;

// TTLs
export const TTL_SMS     = 24 * 60 * 60;       // 24 h — unmatched agent SMS
export const TTL_PENDING = 24 * 60 * 60;       // 24 h — pending user deposit
export const TTL_USED    = 30 * 24 * 60 * 60;  // 30 d — idempotency guard
