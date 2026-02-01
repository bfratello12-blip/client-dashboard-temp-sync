// lib/dates.ts

export function isoDateUTC(d: Date): string {
  // YYYY-MM-DD
  return d.toISOString().slice(0, 10);
}

export function isoDateInTimeZone(d: Date, timeZone: string): string {
  // YYYY-MM-DD in specified IANA timeZone
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);

    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== "literal") map[p.type] = p.value;
    }
    if (!map.year || !map.month || !map.day) return "";
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return "";
  }
}

export function parseIsoDateUTC(day: string): Date {
  // day: YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Invalid ISO day: ${day}`);
  }
  return new Date(`${day}T00:00:00.000Z`);
}

export function addDaysIsoUTC(day: string, deltaDays: number): string {
  const dt = parseIsoDateUTC(day);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return isoDateUTC(dt);
}

export function dateRangeInclusiveUTC(startDay: string, endDay: string): string[] {
  const start = parseIsoDateUTC(startDay);
  const end = parseIsoDateUTC(endDay);
  if (start.getTime() > end.getTime()) return [];

  const out: string[] = [];
  let cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    out.push(isoDateUTC(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function dayWindowUTC(day: string): { start: string; end: string } {
  // [day 00:00:00Z, next day 00:00:00Z)
  const start = `${day}T00:00:00.000Z`;
  const end = `${addDaysIsoUTC(day, 1)}T00:00:00.000Z`;
  return { start, end };
}

export function bucketShopifyOrderDay(order: {
  processedAt?: string | null;
  createdAt?: string | null;
}): string {
  const stamp = order?.processedAt || order?.createdAt;
  if (!stamp) return "";
  const d = new Date(stamp);
  if (!Number.isFinite(d.getTime())) return "";
  return isoDateUTC(d); // ALWAYS UTC
}

export function bucketShopifyOrderDayInTZ(
  order: { processedAt?: string | null; createdAt?: string | null },
  timeZone: string
): string {
  const stamp = order?.processedAt || order?.createdAt;
  if (!stamp) return "";
  const d = new Date(stamp);
  if (!Number.isFinite(d.getTime())) return "";
  return isoDateInTimeZone(d, timeZone);
}


