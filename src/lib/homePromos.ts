import "server-only";
import { connection } from "next/server";
import type { HomePromo } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hiddenReason, slotRows, type PromoRecord, type PromoSlot } from "@/lib/homePromoCore";

/*
 * Homepage promotions: loading what the lobby shows, and the shapes the admin
 * page and the homepage render. Rules live in homePromoCore.
 */

export type PublicPromo = {
  id: string;
  heading: string | null;
  description: string | null;
  imageUrl: string | null;
  mobileImageUrl: string | null;
  imageAlt: string;
  ctaLabel: string | null;
  href: string;
  external: boolean;
  layout: "banner" | "poster";
};

export type SlotRow = { kind: "banner"; promo: PublicPromo } | { kind: "posters"; promos: PublicPromo[] };

export function toRecord(p: HomePromo): PromoRecord {
  return {
    id: p.id, title: p.title, heading: p.heading, description: p.description,
    hasImage: !!p.imageKey, hasMobileImage: !!p.mobileImageKey, imageAlt: p.imageAlt,
    ctaLabel: p.ctaLabel, destType: p.destType, destUrl: p.destUrl, layout: p.layout, slot: p.slot,
    sortOrder: p.sortOrder, isActive: p.isActive, startsAt: p.startsAt, endsAt: p.endsAt,
  };
}

const imageUrl = (p: HomePromo, variant: "desktop" | "mobile") =>
  `/api/home-promos/${p.id}/image?variant=${variant}&v=${p.updatedAt.getTime()}`;

export function toPublic(p: HomePromo): PublicPromo {
  return {
    id: p.id,
    heading: p.heading?.trim() || null,
    description: p.description?.trim() || null,
    imageUrl: p.imageKey ? imageUrl(p, "desktop") : null,
    mobileImageUrl: p.mobileImageKey ? imageUrl(p, "mobile") : null,
    imageAlt: p.imageAlt?.trim() || p.heading?.trim() || "",
    ctaLabel: p.ctaLabel?.trim() || null,
    href: p.destUrl!,
    external: p.destType === "external",
    layout: p.layout === "poster" ? "poster" : "banner",
  };
}

/** The lobby's live promotions, laid out per slot. A slot with nothing live
 *  is simply absent — no empty space on the page. */
export async function getHomePromoSlots(): Promise<Partial<Record<PromoSlot, SlotRow[]>>> {
  await connection(); // time-based: never a build-time snapshot
  const now = new Date();
  const rows = await prisma.homePromo
    .findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })
    .catch(() => []);
  const live = rows.filter((p) => hiddenReason(toRecord(p), now) === null);

  const out: Partial<Record<PromoSlot, SlotRow[]>> = {};
  for (const slot of ["after_first", "middle", "lower"] as const) {
    const inSlot = live.filter((p) => p.slot === slot).map(toPublic);
    if (inSlot.length) out[slot] = slotRows(inSlot) as SlotRow[];
  }
  return out;
}
