/**
 * Returns today's date string (YYYY-MM-DD) in Brasilia time (UTC-3, no DST).
 * Always use this instead of new Date().toISOString().split("T")[0] on the
 * frontend, because toISOString() returns UTC and after 21h BRT the UTC date
 * is already "tomorrow".
 */
export function todayBrazil(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Drizzle/pg returns timestamps without the "Z" suffix (e.g. "2026-05-31T12:58:00.000").
 * Without "Z", new Date() treats the string as *local* time instead of UTC, so the
 * displayed hour is wrong on any device outside UTC. This helper forces UTC parsing.
 */
export function parseUTC(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date(NaN);
  if (dateStr.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr);
  }
  return new Date(dateStr + "Z");
}

/**
 * Parses a date-only string (YYYY-MM-DD) as local time.
 *
 * new Date("2026-06-24") is treated as UTC midnight by the JS spec, which in
 * Brazil (UTC-3) renders as June 23 at 21:00 — one day behind. Appending
 * "T00:00:00" (no Z) forces the browser to parse it as local midnight instead.
 *
 * Use this for any PostgreSQL `date` column (startDate, endDate, birthDate,
 * appliedDate, nextDueDate, etc.). For `timestamp` columns use parseUTC().
 */
export function parseLocalDate(dateStr: string | null | undefined): Date {
  if (!dateStr) return new Date(NaN);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr + "T00:00:00");
  }
  return new Date(dateStr);
}
