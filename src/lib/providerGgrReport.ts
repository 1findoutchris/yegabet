import "server-only";
import { NextRequest } from "next/server";
import { dayIn, resolvePeriod } from "@/lib/providerGgrCore";
import { REPORT_TIMEZONE } from "@/lib/providerGgr";

/** Period + timezone shared by the overview and details endpoints, so both
 *  always cover exactly the same days. */
export function reportRange(req: NextRequest) {
  const tz = REPORT_TIMEZONE();
  const p = req.nextUrl.searchParams;
  const today = dayIn(tz);
  const range = resolvePeriod(p.get("period") ?? "month", today, p.get("from"), p.get("to"));
  return range ? { ...range, tz, today } : null;
}
