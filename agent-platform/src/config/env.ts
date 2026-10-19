import { z } from "zod";

/**
 * Every environment variable the service reads, validated once at boot.
 * A bad or missing value stops the process with a readable list instead of
 * starting half-configured (plan 01 §7).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z
    .string()
    .min(1, "is required")
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "must be a postgresql:// URL"),
  // Optional until the first background job (Task 06).
  REDIS_URL: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Brand placeholders: the name and domain are undecided (CLAUDE.md §2).
  PLATFORM_NAME: z.string().min(1).default("Platform"),
  PLATFORM_DOMAIN: z.string().min(1).default("example.com"),
  APP_VERSION: z.string().min(1).default("dev"),
  // Phone numbers are stored as an HMAC (uniqueness) plus AES-256-GCM ciphertext,
  // never as plain text (§7). Generate each once and back them up:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  PHONE_HASH_KEY: z.string().min(32, "must be at least 32 characters"),
  PHONE_ENC_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded"),
  // Telegram (plan 04). Optional: until the bot is set up, auth routes answer
  // 503 "not configured" instead of the whole app refusing to start.
  TELEGRAM_BOT_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Telegram echoes it on every webhook call (A-Z a-z 0-9 _ -, 1-256 chars).
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine(
      (v) => v === undefined || /^[A-Za-z0-9_-]{16,256}$/.test(v),
      "must be 16-256 chars of A-Z a-z 0-9 _ -",
    ),
  // Where the bot's [Open YegaBet] button and [Continue on website] link go.
  WEBAPP_URL: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  PUBLIC_WEB_URL: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .positive()
    .max(24 * 30)
    .default(12),
});

export type Env = z.infer<typeof schema>;

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

export function loadEnv(raw: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return parsed.data;
}
