import "server-only";
import { NextResponse } from "next/server";
import { auth } from "./auth";

/**
 * Session gate for the in-person betting agent APIs. The agent is a normal
 * User (NextAuth credentials session) whose role is IN_PERSON_AGENT — the
 * role, not a separate table, is what unlocks these routes.
 *
 * Returns the user id on success, or a ready NextResponse error:
 *   401 — not logged in, 403 — logged in but not an in-person agent.
 */
export async function requireInPersonAgent(): Promise<{ userId: string } | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "IN_PERSON_AGENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return { userId: session.user.id };
}

export function isAgentAuthError(r: { userId: string } | NextResponse): r is NextResponse {
  return r instanceof NextResponse;
}
