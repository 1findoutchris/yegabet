import { NextRequest, NextResponse } from "next/server";
import { syncCatalog, catalogConfigured } from "@/lib/catalog";

// Import Octhera's catalog now (the site also does it by itself every hour).
// Guarded by CRON_SECRET. Answers what was imported: counts per section and
// category, whether every page came back, and any Octhera types we couldn't
// place (filed under Games → More Games).
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!catalogConfigured()) {
    return NextResponse.json({ error: "OCTHERA_API_KEY is not set" }, { status: 503 });
  }
  const result = await syncCatalog();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
