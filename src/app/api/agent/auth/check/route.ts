import { NextRequest, NextResponse } from "next/server";
import { verifyAgentSecret } from "@/lib/agentAuth";

/*
 * Secret-URL probe for the in-person agent portal (/agent/<AGENT_SECRET>).
 * The portal layout calls this on mount — wrong secret → 404 so the portal
 * stays hidden, same pattern as admin/payout.
 */
export async function GET(req: NextRequest) {
  if (!verifyAgentSecret(req.headers.get("x-agent-secret") ?? "")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
