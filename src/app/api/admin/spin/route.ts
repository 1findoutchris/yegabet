import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { putObject, deleteObject, storageConfigured } from "@/lib/storage";
import { FULL_BPS } from "@/lib/spinCore";
import { z } from "zod";

/* Prize-wheel CRUD. Prizes are a table rather than a reward-config block
   because `stock` is live state — see the note on the SpinPrize model. */

const MAX_BYTES = 4 * 1024 * 1024;

// A hard ceiling so a fat finger can't mint a million-ETB prize.
const MAX_CASH = 1_000_000;

const prizeFields = {
  label: z.string().trim().min(1).max(80),
  kind: z.enum(["CASH", "PHYSICAL", "SPIN", "NONE"]),
  cashEtb: z.number().min(0).max(MAX_CASH),
  // Coupons awarded by a SPIN prize. Capped so a typo can't hand out a
  // thousand free spins at the top prizes.
  creditsAwarded: z.number().int().min(0).max(50),
  payoutPot: z.enum(["bonus", "withdrawable"]),
  weightBps: z.number().int().min(0).max(FULL_BPS),
  stock: z.number().int().min(0),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
};

/**
 * Refuse a save whose active weights exceed 100%. drawPrize normalises rather
 * than throwing, but in practice an over-100 total is always a typo and this is
 * the last place a human can be told.
 */
async function weightsWouldExceed(excludeId: string | null, addedBps: number): Promise<boolean> {
  const rows = await prisma.spinPrize.findMany({
    where: { isActive: true, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { weightBps: true },
  });
  return rows.reduce((sum, r) => sum + r.weightBps, 0) + addedBps > FULL_BPS;
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const [prizes, physicalWins] = await Promise.all([
    prisma.spinPrize.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.spinResult.findMany({
      where: { kind: "PHYSICAL" },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  // SpinResult has no FK to User (it's an append-only audit log), so the join
  // is done here rather than with an include.
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(physicalWins.map((w) => w.userId))] } },
    select: { id: true, accountNo: true, phone: true, username: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json({
    prizes: prizes.map((p) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      cashEtb: Number(p.cashEtb),
      creditsAwarded: p.creditsAwarded,
      payoutPot: p.payoutPot,
      weightBps: p.weightBps,
      stock: p.stock,
      sortOrder: p.sortOrder,
      isActive: p.isActive,
      imageUrl: p.imageKey ? `/api/rewards/prize/${p.id}/image?v=${p.updatedAt.getTime()}` : null,
    })),
    physicalWins: physicalWins.map((w) => ({
      id: w.id,
      label: w.label,
      createdAt: w.createdAt.toISOString(),
      accountNo: byId.get(w.userId)?.accountNo ?? null,
      phone: byId.get(w.userId)?.phone ?? "—",
      username: byId.get(w.userId)?.username ?? w.userId,
    })),
  });
}

// Create — multipart, because the image comes with it (mirrors /api/admin/promos).
export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const num = (k: string) => Number(form.get(k) ?? 0);
  const parsed = z.object(prizeFields).safeParse({
    label: String(form.get("label") ?? ""),
    kind: String(form.get("kind") ?? "CASH"),
    cashEtb: num("cashEtb"),
    creditsAwarded: num("creditsAwarded"),
    payoutPot: String(form.get("payoutPot") ?? "bonus"),
    weightBps: num("weightBps"),
    stock: num("stock"),
    sortOrder: num("sortOrder"),
    isActive: form.get("isActive") !== "false",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid prize" }, { status: 400 });
  }

  if (parsed.data.isActive && (await weightsWouldExceed(null, parsed.data.weightBps))) {
    return NextResponse.json({ error: "Total win chance would exceed 100%" }, { status: 400 });
  }

  const prize = await prisma.spinPrize.create({ data: parsed.data });

  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    if (!storageConfigured()) {
      return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Must be an image" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image must be under 4 MB" }, { status: 400 });
    }
    const key = `prizes/${prize.id}`;
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
    await prisma.spinPrize.update({ where: { id: prize.id }, data: { imageKey: key } });
  }

  await logAdminAction({
    action: "CREATE_SPIN_PRIZE",
    targetId: prize.id,
    targetType: "SpinPrize",
    note: parsed.data.label,
    ipAddress: getClientIp(req),
    metadata: { ...parsed.data },
  });

  return NextResponse.json({ success: true, id: prize.id });
}

const patchSchema = z.object({ id: z.string().min(1) }).extend(prizeFields).partial({
  label: true, kind: true, cashEtb: true, creditsAwarded: true, payoutPot: true,
  weightBps: true, stock: true, sortOrder: true, isActive: true,
});

// Update one prize. `stock` is an authoritative SET, not a delta — a restock is
// "there are now 20", not "add 20".
export async function PATCH(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const { id, ...fields } = parsed.data;
  const current = await prisma.spinPrize.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextActive = fields.isActive ?? current.isActive;
  const nextWeight = fields.weightBps ?? current.weightBps;
  if (nextActive && (await weightsWouldExceed(id, nextWeight))) {
    return NextResponse.json({ error: "Total win chance would exceed 100%" }, { status: 400 });
  }

  await prisma.spinPrize.update({ where: { id }, data: fields });

  await logAdminAction({
    action: "UPDATE_SPIN_PRIZE",
    targetId: id,
    targetType: "SpinPrize",
    note: current.label,
    ipAddress: getClientIp(req),
    metadata: { ...fields },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const prize = await prisma.spinPrize.findUnique({ where: { id } });
  if (!prize) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (prize.imageKey) await deleteObject(prize.imageKey);
  // Safe: SpinResult stores a label/kind/cash snapshot and holds no FK, so past
  // wins stay readable after the prize is gone.
  await prisma.spinPrize.delete({ where: { id } });

  await logAdminAction({
    action: "DELETE_SPIN_PRIZE",
    targetId: id,
    targetType: "SpinPrize",
    note: prize.label,
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ success: true });
}
