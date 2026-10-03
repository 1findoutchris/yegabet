import "server-only";
import { NextResponse } from "next/server";
import { auth } from "./auth";
import { prisma } from "./prisma";
import { isOctheraTester, octheraUsername } from "./providers/octhera";

/*
 * Gate for the Octhera test APIs: logged in AND listed in OCTHERA_TEST_USERS
 * (checked against the account in the DB, not just the session). Anyone else
 * gets 404 so the test page stays invisible.
 */
export async function requireOctheraTester(): Promise<{ userId: string; username: string } | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, phone: true, username: true },
  });
  if (!user || !isOctheraTester(user)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return { userId: user.id, username: octheraUsername(user.id) };
}
