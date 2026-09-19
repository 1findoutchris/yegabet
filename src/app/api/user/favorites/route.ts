import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET — the current user's favorite game IDs (for hydrating the heart state).
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const favorites = await prisma.favoriteGame.findMany({
    where: { userId: session.user.id },
    select: { gameId: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ ids: favorites.map((f) => f.gameId) });
}

const toggleSchema = z.object({
  gameId: z.string().min(1),
  // Optional explicit target; when omitted we flip the current state.
  favorite: z.boolean().optional(),
});

// POST — add/remove a favorite. Returns the resulting state.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { gameId } = parsed.data;
  const userId = session.user.id;
  const where = { userId_gameId: { userId, gameId } };

  const existing = await prisma.favoriteGame.findUnique({ where });
  const target = parsed.data.favorite ?? !existing;

  if (target && !existing) {
    await prisma.favoriteGame.create({ data: { userId, gameId } });
  } else if (!target && existing) {
    await prisma.favoriteGame.delete({ where });
  }

  return NextResponse.json({ favorite: target });
}
