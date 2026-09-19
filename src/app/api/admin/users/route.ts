import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAuth } from "@/lib/adminAuth";
import { tierForPoints } from "@/lib/retention";
import { getRewardConfig } from "@/lib/rewardConfig";
import { withdrawable } from "@/lib/wallet";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = 25;

  // An all-digits query is also tried as an account number — that number is what
  // a player reads out to support, so it has to find them here. Parsed rather
  // than `contains`, since accountNo is an integer column; anything outside
  // Int range is left to the phone match instead of overflowing the query.
  const asAccountNo = /^\d{1,10}$/.test(q) && Number(q) <= 2_147_483_647 ? Number(q) : null;

  const where = q
    ? {
        OR: [
          { username: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q } },
          { name: { contains: q, mode: "insensitive" as const } },
          ...(asAccountNo !== null ? [{ accountNo: asAccountNo }] : []),
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, accountNo: true, username: true, name: true, phone: true,
        balance: true, depositBalance: true, bonusBalance: true,
        loyaltyPoints: true, isActive: true, isVerified: true,
        role: true, createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  const { tiers } = await getRewardConfig();

  return NextResponse.json({
    items: users.map((u) => toRow(u, tiers)),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}

/**
 * Shapes one row of the response.
 *
 * Extracted so the client can DERIVE its type from it (see AdminUserRow below)
 * rather than hand-writing an interface that drifts. Removing a field from the
 * `select` above changes this function's input, which changes AdminUserRow,
 * which is a compile error at every page that reads the field.
 *
 * It cannot be derived from the handler's return type: every guarded route also
 * returns a bare `NextResponse` from requireAdminAuth, and TypeScript collapses
 * `NextResponse<{…}> | NextResponse<unknown>` to `NextResponse<unknown>` by
 * subtype reduction — so the payload type is erased before it can be read back.
 */
function toRow(
  u: {
    id: string; accountNo: number; username: string; name: string | null; phone: string;
    balance: Prisma.Decimal; depositBalance: Prisma.Decimal; bonusBalance: Prisma.Decimal;
    loyaltyPoints: number; isActive: boolean; isVerified: boolean;
    role: string; createdAt: Date;
  },
  tiers: Parameters<typeof tierForPoints>[1],
) {
  return {
    ...u,
    balance: Number(u.balance),
    bonusBalance: Number(u.bonusBalance),
    depositBalance: Number(u.depositBalance),
    withdrawable: withdrawable({
      balance: Number(u.balance),
      depositBalance: Number(u.depositBalance),
      bonusBalance: Number(u.bonusBalance),
    }),
    loyaltyTier: tierForPoints(u.loyaltyPoints, tiers).id.toUpperCase(),
  };
}

/** One row of GET /api/admin/users, derived from the mapping above. */
export type AdminUserRow = ReturnType<typeof toRow>;
