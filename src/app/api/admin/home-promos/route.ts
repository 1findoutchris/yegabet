import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getClientIp, logAdminAction, requireAdminAuth } from "@/lib/adminAuth";
import { deleteObject, putObject, storageConfigured } from "@/lib/storage";
import {
  hiddenReason, imageProblem, isDestType, isLayout, isSlot, validDestination,
} from "@/lib/homePromoCore";
import { toPublic, toRecord } from "@/lib/homePromos";

/*
 * Admin → Homepage Promos.
 *   GET    every promotion, in display order, with why it is hidden (if it is)
 *   POST   create (multipart: fields + optional desktop/mobile images)
 *   PUT    edit   (multipart, same fields + id; images optional, "remove…" flags)
 *   PATCH  { id, isActive } toggle, or { order: [{ id, slot, sortOrder }] } reorder
 *   DELETE ?id=
 */

export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;
  const rows = await prisma.homePromo.findMany({ orderBy: [{ slot: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] });
  const now = new Date();
  return NextResponse.json({
    storage: canUpload(),
    promos: rows.map((p) => ({
      ...toRecord(p),
      startsAt: p.startsAt?.toISOString() ?? null,
      endsAt: p.endsAt?.toISOString() ?? null,
      hiddenReason: hiddenReason(toRecord(p), now),
      // What the homepage would render — used for the admin preview.
      preview: { ...toPublic({ ...p, destUrl: p.destUrl ?? "#" }) },
    })),
  });
}

/** Outside production, storage falls back to local disk (lib/storage). */
const canUpload = () => storageConfigured() || process.env.NODE_ENV !== "production";

const str = (v: FormDataEntryValue | null, max: number) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};
const date = (v: FormDataEntryValue | null): Date | null | "invalid" => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
};

type Fields = {
  title: string; heading: string | null; description: string | null; imageAlt: string | null;
  ctaLabel: string | null; destType: string; destUrl: string | null; layout: string; slot: string;
  sortOrder: number; isActive: boolean; startsAt: Date | null; endsAt: Date | null;
};

/** Validate the form. Returns the fields or an error message. */
function readFields(form: FormData): Fields | string {
  const title = str(form.get("title"), 120);
  if (!title) return "Internal title is required";
  const destType = str(form.get("destType"), 20) ?? "internal";
  const destUrl = str(form.get("destUrl"), 500);
  const layout = str(form.get("layout"), 20) ?? "banner";
  const slot = str(form.get("slot"), 30) ?? "after_first";
  if (!isDestType(destType)) return "Unknown destination type";
  if (!isLayout(layout)) return "Unknown layout";
  if (!isSlot(slot)) return "Unknown placement";
  if (destUrl && !validDestination(destType, destUrl)) {
    return destType === "external"
      ? "External links must be a full https:// address"
      : "Internal links must be a path on this site, e.g. /deposit";
  }
  const startsAt = date(form.get("startsAt"));
  const endsAt = date(form.get("endsAt"));
  if (startsAt === "invalid" || endsAt === "invalid") return "Invalid date";
  if (startsAt && endsAt && endsAt <= startsAt) return "End must be after start";
  const sortOrder = Number(form.get("sortOrder") ?? 0);
  return {
    title,
    heading: str(form.get("heading"), 80),
    description: str(form.get("description"), 200),
    imageAlt: str(form.get("imageAlt"), 200),
    ctaLabel: str(form.get("ctaLabel"), 30),
    destType, destUrl, layout, slot,
    sortOrder: Number.isInteger(sortOrder) && sortOrder >= 0 && sortOrder <= 999 ? sortOrder : 0,
    isActive: form.get("isActive") === "true",
    startsAt, endsAt,
  };
}

/** Upload one optional image field. Returns the new key, null when absent, or an error. */
async function upload(form: FormData, field: "image" | "mobileImage", id: string): Promise<string | null | { error: string }> {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) return null;
  const problem = imageProblem(file);
  if (problem) return { error: problem };
  if (!canUpload()) return { error: "Image storage isn't configured" };
  // A fresh key per upload, so caches never serve the old image.
  const key = `home-promos/${id}/${field}-${Date.now()}`;
  await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  return key;
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;
  const form = await req.formData().catch(() => null);
  if (!form) return bad("Invalid form");
  const fields = readFields(form);
  if (typeof fields === "string") return bad(fields);

  // Validate images before creating anything.
  for (const f of ["image", "mobileImage"] as const) {
    const file = form.get(f);
    if (file instanceof File && file.size > 0) {
      const problem = imageProblem(file);
      if (problem) return bad(problem);
    }
  }

  const promo = await prisma.homePromo.create({ data: fields });
  const image = await upload(form, "image", promo.id);
  const mobile = await upload(form, "mobileImage", promo.id);
  for (const r of [image, mobile]) {
    if (r && typeof r === "object") {
      await prisma.homePromo.delete({ where: { id: promo.id } });
      return bad(r.error);
    }
  }
  const saved = await prisma.homePromo.update({
    where: { id: promo.id },
    data: { imageKey: image as string | null, mobileImageKey: mobile as string | null },
  });
  await logAdminAction({ action: "CREATE_HOME_PROMO", targetId: saved.id, targetType: "HomePromo", note: saved.title, ipAddress: getClientIp(req) });
  return NextResponse.json({ success: true, id: saved.id, hiddenReason: hiddenReason(toRecord(saved), new Date()) });
}

export async function PUT(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;
  const form = await req.formData().catch(() => null);
  const id = form ? str(form.get("id"), 64) : null;
  if (!form || !id) return bad("Invalid form");
  const existing = await prisma.homePromo.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const fields = readFields(form);
  if (typeof fields === "string") return bad(fields);

  const image = await upload(form, "image", id);
  if (image && typeof image === "object") return bad(image.error);
  const mobile = await upload(form, "mobileImage", id);
  if (mobile && typeof mobile === "object") return bad(mobile.error);

  const removeImage = form.get("removeImage") === "true";
  const removeMobile = form.get("removeMobileImage") === "true";
  const imageKey = image ?? (removeImage ? null : existing.imageKey);
  const mobileImageKey = mobile ?? (removeMobile ? null : existing.mobileImageKey);

  const saved = await prisma.homePromo.update({ where: { id }, data: { ...fields, imageKey, mobileImageKey } });
  // Old files are only deleted once the row no longer points at them.
  if (existing.imageKey && existing.imageKey !== imageKey) await deleteObject(existing.imageKey).catch(() => {});
  if (existing.mobileImageKey && existing.mobileImageKey !== mobileImageKey) await deleteObject(existing.mobileImageKey).catch(() => {});

  await logAdminAction({ action: "UPDATE_HOME_PROMO", targetId: id, targetType: "HomePromo", note: saved.title, ipAddress: getClientIp(req) });
  return NextResponse.json({ success: true, hiddenReason: hiddenReason(toRecord(saved), new Date()) });
}

const patchSchema = z.union([
  z.object({ id: z.string().min(1), isActive: z.boolean() }),
  z.object({
    order: z.array(z.object({
      id: z.string().min(1),
      slot: z.string().refine(isSlot),
      sortOrder: z.number().int().min(0).max(999),
    })).min(1).max(200),
  }),
]);

export async function PATCH(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("Invalid request");

  if ("order" in parsed.data) {
    await prisma.$transaction(parsed.data.order.map((o) =>
      prisma.homePromo.updateMany({ where: { id: o.id }, data: { slot: o.slot, sortOrder: o.sortOrder } }),
    ));
    await logAdminAction({ action: "REORDER_HOME_PROMOS", targetType: "HomePromo", ipAddress: getClientIp(req), metadata: { order: parsed.data.order } });
    return NextResponse.json({ success: true });
  }

  const { id, isActive } = parsed.data;
  const r = await prisma.homePromo.updateMany({ where: { id }, data: { isActive } });
  if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await logAdminAction({ action: isActive ? "ENABLE_HOME_PROMO" : "DISABLE_HOME_PROMO", targetId: id, targetType: "HomePromo", ipAddress: getClientIp(req) });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const p = await prisma.homePromo.findUnique({ where: { id } });
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.homePromo.delete({ where: { id } });
  for (const k of [p.imageKey, p.mobileImageKey]) if (k) await deleteObject(k).catch(() => {});
  await logAdminAction({ action: "DELETE_HOME_PROMO", targetId: id, targetType: "HomePromo", note: p.title, ipAddress: getClientIp(req) });
  return NextResponse.json({ success: true });
}
