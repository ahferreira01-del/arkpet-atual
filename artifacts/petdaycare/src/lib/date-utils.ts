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
