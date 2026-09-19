import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRewardConfig } from "@/lib/rewardConfig";
import { grantBonus, type GrantPot } from "@/lib/bonus";
import { publishBalanceEvent } from "@/lib/balanceEvents";
import { withdrawable } from "@/lib/wallet";
import { logAdminAction } from "@/lib/adminAuth";
import { resolveSpin } from "@/lib/spinCore";

/* The prize wheel.
 *
 * One spin costs one `spinCredits` coupon, earned by referring a verified
 * signup. The server decides the outcome and returns the wedge index; the
 * client only animates to it — see SpinWheel.tsx for why that ordering matters.
 */

class NoSpinsError extends Error {}
class WheelClosedError extends Error {}

/** Wedges as the player sees them — deliberately without `weightBps`, since the
 *  odds table shouldn't be a public API. */
function toPublic(p: {
  id: string; label: string; kind: string; cashEtb: unknown;
  creditsAwarded: number; stock: number; imageKey: string | null;
}) {
  return {
    id: p.id,
    label: p.label,
    kind: p.kind,
    cashEtb: Number(p.cashEtb),
    creditsAwarded: p.creditsAwarded,
    imageUrl: p.imageKey ? `/api/rewards/prize/${p.id}/image` : null,
    inStock: p.kind === "NONE" || p.stock > 0,
  };
}

/** Try-again wedges are never consumed, so stock is irrelevant to them. */
const UNLIMITED = Number.MAX_SAFE_INTEGER;
const drawStock = (p: { kind: string; stock: number }) =>
  p.kind === "NONE" ? UNLIMITED : p.stock;

const activePrizes = {
  where: { isActive: true },
  orderBy: { sortOrder: "asc" },
} as const;

// GET — the wheel's current state for this player.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [user, prizes, { spinWheel }] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { spinCredits: true } }),
    prisma.spinPrize.findMany(activePrizes),
    getRewardConfig(),
  ]);

  return NextResponse.json({
    enabled: spinWheel.enabled,
    spinCredits: user?.spinCredits ?? 0,
    segments: prizes.map(toPublic),
  });
}

// POST — spend one coupon and spin. No request body, so nothing to validate.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // ponytail: no idempotency key. The compare-and-set on spinCredits makes
  // over-spend impossible, so a double-tap is two legitimate spins costing two
  // coupons — not a duplicated payout. The client disables the button in flight.
  const reference = `spin-${userId}-${randomUUID()}`;

  try {
    // Read config before opening the transaction — it runs on its own
    // connection and would otherwise hold the transaction open for no reason.
    const { spinWheel } = await getRewardConfig();
    if (!spinWheel.enabled) throw new WheelClosedError();

    const result = await prisma.$transaction(async (tx) => {
      // Debit FIRST. Any failure after this rolls the whole transaction back,
      // but doing it in this order means there is no ordering in which a bug
      // could mint a free spin.
      const spent = await tx.user.updateMany({
        where: { id: userId, spinCredits: { gte: 1 } },
        data: { spinCredits: { decrement: 1 } },
      });
      if (spent.count === 0) throw new NoSpinsError();

      // ALL active prizes, including out-of-stock ones: the wedge index must
      // line up with what the client rendered. drawPrize filters stock itself.
      const prizes = await tx.spinPrize.findMany(activePrizes);

      // Pending guarantee from an admin-issued rigged link. This read only
      // learns WHICH prize — the updateMany below is what decides, so two
      // concurrent spins can never both consume it. Deciding on this read
      // instead of on the write is the one path to a doubled payout.
      const link = await tx.spinLink.findFirst({
        where: { claimedByUserId: userId, fulfilledRef: null },
        select: { id: true, prizeId: true },
      });
      const onWheel = !!link && prizes.some((p) => p.id === link.prizeId);

      let guaranteed = false;
      if (link && onWheel) {
        const consumed = await tx.spinLink.updateMany({
          where: { id: link.id, fulfilledRef: null },
          // Same reference the SpinResult will carry, so the consume-marker and
          // the audit pointer are one write.
          data: { fulfilledRef: reference },
        });
        guaranteed = consumed.count === 1;
      }
      // If the prize is no longer on the wheel the link stays PENDING rather
      // than being burned — the admin can reactivate it and the recipient's
      // next spin wins it. Silently consuming an unkeepable promise is worse.

      const outcome = resolveSpin(
        prizes.map((p) => ({ id: p.id, weightBps: p.weightBps, stock: drawStock(p) })),
        Math.random(),
        guaranteed ? link!.prizeId : undefined,
      );

      let won = outcome.prizeId ? prizes.find((p) => p.id === outcome.prizeId) ?? null : null;
      let index = outcome.index;
      let stockRace = false;
      let overstock = false;

      // A NONE wedge is a loss the player can see the wheel land on, so it
      // keeps its index but consumes no stock and pays nothing.
      if (won && won.kind !== "NONE") {
        // Guarded decrement — another spin may have taken the last unit between
        // our read and this write.
        const taken = await tx.spinPrize.updateMany({
          where: { id: won.id, stock: { gt: 0 } },
          data: { stock: { decrement: 1 } },
        });
        if (taken.count === 0) {
          if (guaranteed) {
            // A rigged link pays out even at zero stock, by design. The
            // `stock: { gt: 0 }` predicate above is what keeps that legal —
            // the decrement simply never ran, so CHECK (stock >= 0) holds and
            // stock stays at 0 rather than going negative. Recorded, not
            // swallowed, since it means more went out than existed.
            overstock = true;
          } else {
            // Downgrade to a no-win rather than re-drawing (a second roll of the
            // dice is a fairness hole) or erroring (that would cost the player a
            // coupon for a server-side race). Flagged so it's auditable.
            stockRace = true;
            won = null;
            index = -1;
          }
        }
      }

      const isWin = !!won && won.kind !== "NONE";
      const cashEtb = isWin && won!.kind === "CASH" ? Number(won!.cashEtb) : 0;
      const creditsWon = isWin && won!.kind === "SPIN" ? won!.creditsAwarded : 0;

      if (cashEtb > 0) {
        await grantBonus(tx, {
          userId,
          amount: cashEtb,
          reference,
          kind: "spin_prize",
          pot: won!.payoutPot as GrantPot,
          metadata: { prizeId: won!.id, label: won!.label },
        });
      }

      // Winning coupons tops the player's wallet straight back up. No ledger
      // row: spinCredits isn't money, and SpinResult already records the award.
      if (creditsWon > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { spinCredits: { increment: creditsWon } },
        });
      }

      const spin = await tx.spinResult.create({
        data: {
          userId,
          prizeId: won?.id ?? null,
          label: won?.label ?? "No win",
          // NONE covers both an explicit try-again wedge and the implicit
          // below-100% remainder, so the audit reads the same either way.
          kind: isWin ? won!.kind : "NONE",
          cashEtb,
          reference,
          metadata: {
            ...(stockRace ? { stockRace: true, intendedPrizeId: outcome.prizeId } : {}),
            ...(creditsWon > 0 ? { creditsAwarded: creditsWon } : {}),
            ...(guaranteed ? { guaranteed: true, spinLinkId: link!.id } : {}),
            ...(overstock ? { guaranteedOverstock: true } : {}),
          },
        },
      });

      return {
        spinId: spin.id,
        index,
        prizeId: won?.id ?? null,
        label: spin.label,
        kind: spin.kind,
        cashEtb,
        creditsWon,
        guaranteed,
        payoutPot: won?.payoutPot ?? null,
      };
    });

    // Cash landed in a wallet pot — nudge other open tabs to re-read.
    if (result.cashEtb > 0) {
      const fresh = await prisma.user.findUnique({
        where: { id: userId },
        select: { balance: true, depositBalance: true, bonusBalance: true },
      });
      if (fresh) {
        await publishBalanceEvent(userId, {
          balance: Number(fresh.balance),
          withdrawable: withdrawable({
            balance: Number(fresh.balance),
            depositBalance: Number(fresh.depositBalance),
            bonusBalance: Number(fresh.bonusBalance),
          }),
          reason: "bonus",
        });
      }
    }

    // Physical prizes can't be auto-credited — record it where admin already
    // looks. The durable record is the SpinResult row, surfaced at
    // /admin/<secret>/spin; this is the notification on top of it.
    if (result.kind === "PHYSICAL") {
      await logAdminAction({
        action: "SPIN_PHYSICAL_WIN",
        targetId: result.spinId,
        targetType: "SpinResult",
        note: result.label,
        // `guaranteed` distinguishes a rigged-link payout from a real win.
        metadata: {
          userId, prizeId: result.prizeId, label: result.label,
          guaranteed: result.guaranteed,
        },
      });
    }

    const [user, prizes] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { spinCredits: true } }),
      prisma.spinPrize.findMany(activePrizes),
    ]);

    return NextResponse.json({
      success: true,
      index: result.index,
      label: result.label,
      kind: result.kind,
      cashEtb: result.cashEtb,
      creditsWon: result.creditsWon,
      payoutPot: result.payoutPot,
      spinCredits: user?.spinCredits ?? 0,
      // Returned so the client re-renders the wedges from this response before
      // rotating — otherwise an admin reordering prizes between the client's
      // GET and this POST would leave `index` pointing at the wrong wedge.
      segments: prizes.map(toPublic),
    });
  } catch (e) {
    if (e instanceof NoSpinsError) {
      return NextResponse.json({ error: "You have no spins left." }, { status: 400 });
    }
    if (e instanceof WheelClosedError) {
      return NextResponse.json({ error: "The wheel is closed right now." }, { status: 400 });
    }
    console.error("[user/spin] spin failed", e);
    return NextResponse.json({ error: "Could not spin" }, { status: 500 });
  }
}
