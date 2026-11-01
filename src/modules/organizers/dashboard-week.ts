import { Temporal } from "@js-temporal/polyfill";

export function dashboardDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  try { const date = Temporal.PlainDate.from(value); return date.year >= 1 && date.year <= 9998 && date.toString() === value ? value : null; } catch { return null; }
}

export function dashboardWeek(now: Date, timezone: string, value?: unknown) {
  const today = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(timezone).toPlainDate();
  const selected = dashboardDate(value);
  const date = selected ? Temporal.PlainDate.from(selected) : today;
  const monday = date.subtract({ days: date.dayOfWeek - 1 });
  const days = Array.from({ length: 7 }, (_, index) => {
    const local = monday.add({ days: index });
    const start = local.toZonedDateTime(timezone).startOfDay();
    const end = local.add({ days: 1 }).toZonedDateTime(timezone).startOfDay();
    return { date: local.toString(), start: new Date(start.epochMilliseconds), end: new Date(end.epochMilliseconds) };
  });
  return { today: today.toString(), selectedDate: date.toString(), filtered: selected !== null, days,
    previous: dashboardDate(date.subtract({ days: 7 }).toString()), next: dashboardDate(date.add({ days: 7 }).toString()) };
}

export function dashboardHref(date?: string | null, page = 1) {
  if (!date) return "/dashboard";
  const query = new URLSearchParams({ date });
  if (page > 1) query.set("dayPage", String(page));
  return `/dashboard?${query}`;
}

// A date has no browser timezone. Noon UTC is used only to format its label.
export function dashboardDateLabel(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function dashboardDayPage(value: unknown) {
  return typeof value === "string" && /^[1-9]\d{0,5}$/u.test(value) ? Number(value) : 1;
}
