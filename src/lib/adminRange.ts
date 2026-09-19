/**
 * Shared period → date-range resolution for the admin report endpoints.
 *
 * The range boundaries are local-time midnights (setHours), so the day buckets
 * have to be local too. toISOString() would bucket by UTC day, putting a 01:00
 * EAT deposit on the previous day in the report while the deposits page
 * (toLocaleString) still shows it as today.
 */
export function dayKey(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function startOf(date: Date, unit: "day" | "week" | "month"): Date {
  const d = new Date(date);
  if (unit === "day") {
    d.setHours(0, 0, 0, 0);
  } else if (unit === "week") {
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
  } else {
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

/** Reads `period` (today|week|month|custom) plus `from`/`to` off the query string. */
export function resolveRange(searchParams: URLSearchParams): {
  period: string;
  from: Date;
  to: Date;
} {
  const period = searchParams.get("period") ?? "week";
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const now = new Date();
  let from: Date;
  let to: Date = new Date(now);
  to.setHours(23, 59, 59, 999);

  if (period === "today") {
    from = startOf(now, "day");
  } else if (period === "month") {
    from = startOf(now, "month");
  } else if (period === "custom" && fromParam && toParam) {
    from = new Date(fromParam);
    to = new Date(toParam);
    to.setHours(23, 59, 59, 999);
  } else {
    from = startOf(now, "week");
  }

  return { period, from, to };
}
