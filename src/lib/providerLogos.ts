import "server-only";
import { existsSync } from "fs";
import path from "path";

/*
 * Provider logos are plain files: public/providers/<provider-slug>.svg (or
 * .png / .webp), named after the slug in the provider's URL (/casino/<slug>).
 * Drop a file in and it shows; without one the tile shows the provider's
 * name as clean text. Checked once per slug per server process.
 */
const DIR = path.join(process.cwd(), "public", "providers");
const EXTS = ["svg", "webp", "png"];
const cache = new Map<string, string | null>();

export function providerLogo(slug: string): string | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  if (!cache.has(slug)) {
    const ext = EXTS.find((e) => existsSync(path.join(DIR, `${slug}.${e}`)));
    cache.set(slug, ext ? `/providers/${slug}.${ext}` : null);
  }
  return cache.get(slug)!;
}
