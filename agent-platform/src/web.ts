import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";

/**
 * The web app (plan 11 lite) is served by this same service at "/", so the
 * session cookie is same-origin. Its pages use "#/…" routes, so they never
 * collide with API paths like /admin or /agent.
 *
 * Content-Security-Policy: our own scripts plus Telegram's Mini App bridge and
 * Login Widget only; framing allowed only by Telegram (the Mini App runs in a
 * frame on Telegram Web). Game artwork comes from providers' hosts, hence img-src https:.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "connect-src 'self'",
  "frame-src https://oauth.telegram.org",
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

export function configureWeb(app: NestExpressApplication, dir: string): boolean {
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  if (!existsSync(join(dir, "index.html"))) return false;
  app.useStaticAssets(dir, {
    index: "index.html",
    // Hashed bundles can be cached for long; index.html must always be fresh.
    setHeaders: (res, path) =>
      res.setHeader(
        "Cache-Control",
        path.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable",
      ),
  });
  return true;
}
