import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ depositId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { depositId } = await params;
  const deposit = await prisma.depositRequest.findFirst({
    where: { id: depositId, userId: session.user.id },
    select: { status: true, amount: true, method: true, createdAt: true },
  });

  if (!deposit) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(deposit);
}
