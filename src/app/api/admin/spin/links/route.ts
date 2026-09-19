import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAdminAuth, logAdminAction, getClientIp } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

/* Admin-issued "rigged" links. Each one guarantees a specific prize to the
   FIRST person who signs up through it, then dies. The claim itself happens in
   the register route; this file only mints, lists and deletes them. */

export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const links = await prisma.spinLink.findMany({ orderBy: { createdAt: "desc" }, take: 200 });

  // Manual joins — SpinLink deliberately has no foreign keys, same as
  // SpinResult. Two lookups beat 200 round trips.
  const [prizes, users] = await Promise.all([
    prisma.spinPrize.findMany({ select: { id: true, isActive: true, kind: true, cashEtb: true, payoutPot: true } }),
    prisma.user.findMany({
      where: { id: { in: links.map((l) => l.claimedByUserId).filter((v): v is string => !!v) } },
      select: { id: true, accountNo: true, phone: true, username: true },
    }),
  ]);
  const prizeById = new Map(prizes.map((p) => [p.id, p]));
  const userById = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json({
    links: links.map((l) => {
      const prize = prizeById.get(l.prizeId);
      const claimer = l.claimedByUserId ? userById.get(l.claimedByUserId) : null;
      return {
        id: l.id,
        code: l.code,
        prizeLabel: l.prizeLabel,
        note: l.note,
        // A link whose prize was deleted or switched off can't pay out — the
        // spin falls back to a fair draw and leaves the link pending.
        prizeLive: !!prize?.isActive,
        cashEtb: prize ? Number(prize.cashEtb) : 0,
        payoutPot: prize?.payoutPot ?? null,
        status: l.fulfilledRef ? "WON" : l.claimedByUserId ? "CLAIMED" : "UNCLAIMED",
        claimedBy: claimer ? (claimer.username ?? claimer.phone) : null,
        claimedByAccountNo: claimer?.accountNo ?? null,
        claimedAt: l.claimedAt,
        createdAt: l.createdAt,
      };
    }),
  });
}

/** Batch ceiling. Each link is a guaranteed payout, so `count × cashEtb` is
 *  real money — the admin UI shows that total before letting you generate. */
const MAX_BATCH = 100;

const createSchema = z.object({
  prizeId: z.string().min(1),
  note: z.string().trim().max(120).optional(),
  /** How many independent single-use links to mint. */
  count: z.number().int().min(1).max(MAX_BATCH).default(1),
});

export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const prize = await prisma.spinPrize.findUnique({ where: { id: parsed.data.prizeId } });
  if (!prize) return NextResponse.json({ error: "Prize not found" }, { status: 404 });
  // A link guaranteeing a try-again wedge is always a mistake.
  if (prize.kind === "NONE") {
    return NextResponse.json({ error: "Cannot guarantee a try-again wedge" }, { status: 400 });
  }

  const { count, note } = parsed.data;

  // 64 bits each, URL-safe. Not the read-aloud alphabet used for payout codes —
  // these are only ever copied out of a URL, never dictated over the phone.
  // ponytail: no collision retry. The unique index is the guard, and at 64 bits
  // a clash across a million links is ~1e-7 — if P2002 ever fires, click again.
  const codes = Array.from({ length: count }, () => randomBytes(8).toString("base64url"));

  // createMany is one statement and all-or-nothing, so a duplicate code (or any
  // other failure) leaves NO partial batch behind for the admin to reconcile.
  await prisma.spinLink.createMany({
    data: codes.map((code) => ({
      code,
      prizeId: prize.id,
      prizeLabel: prize.label, // snapshot, so a renamed or deleted prize still reads
      note: note || null,
    })),
  });

  await logAdminAction({
    action: count > 1 ? "CREATE_SPIN_LINKS" : "CREATE_SPIN_LINK",
    targetId: prize.id,
    targetType: "SpinLink",
    note: `${count} × ${prize.label}${note ? ` · ${note}` : ""}`,
    ipAddress: getClientIp(req),
    metadata: {
      count, codes, prizeId: prize.id, label: prize.label,
      cashEtb: Number(prize.cashEtb), payoutPot: prize.payoutPot,
      // What this batch could cost if every link is claimed and spun.
      totalExposureEtb: Number(prize.cashEtb) * count,
    },
  });

  return NextResponse.json({ success: true, codes, count });
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const id = req.nextUrl.searchParams.get("id") ?? "";

  // Compare-and-set again: a claimed link is somebody's audit trail and an
  // outstanding promise, so it is never deletable.
  const deleted = await prisma.spinLink.deleteMany({
    where: { id, claimedByUserId: null },
  });
  if (deleted.count === 0) {
    return NextResponse.json(
      { error: "Link not found, or already claimed (claimed links are kept for audit)" },
      { status: 409 }
    );
  }

  await logAdminAction({
    action: "DELETE_SPIN_LINK", targetId: id, targetType: "SpinLink",
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ success: true });
}
