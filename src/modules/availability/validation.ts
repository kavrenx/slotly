import { z } from "zod";

export function isNamedTimezone(value: string) {
  if (!/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/u.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; } catch { return false; }
}
const windowShape = { startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) };
const windowInput = z.strictObject(windowShape).refine((w) => w.startMinute < w.endMinute);
const weeklyWindowInput = z.strictObject({ ...windowShape, weekday: z.number().int().min(1).max(7) }).refine((w) => w.startMinute < w.endMinute);
function overlaps(windows: { startMinute: number; endMinute: number }[]) {
  const sorted = [...windows].sort((a, b) => a.startMinute - b.startMinute);
  return sorted.some((w, i) => i > 0 && w.startMinute < sorted[i - 1]!.endMinute);
}
export const scheduleInput = z.strictObject({
  version: z.number().int().min(0).max(2_147_483_646),
  timezone: z.string().max(64).refine(isNamedTimezone),
  weekly: z.array(weeklyWindowInput).max(56),
  overrides: z.array(z.strictObject({
    localDate: z.iso.date().refine((date) => !date.startsWith("0000")),
    mode: z.enum(["closed", "replace"]), windows: z.array(windowInput).max(8),
  })).max(366),
}).superRefine((data, context) => {
  for (let day = 1; day <= 7; day++) {
    const windows = data.weekly.filter((w) => w.weekday === day);
    if (windows.length > 8 || overlaps(windows)) context.addIssue({ code: "custom", path: ["weekly"], message: "OVERLAPPING_WINDOWS" });
  }
  const dates = new Set<string>();
  data.overrides.forEach((override, index) => {
    if (dates.has(override.localDate)) context.addIssue({ code: "custom", path: ["overrides", index], message: "DUPLICATE_DATE" });
    dates.add(override.localDate);
    if ((override.mode === "closed" && override.windows.length !== 0)
      || (override.mode === "replace" && override.windows.length === 0) || overlaps(override.windows)) {
      context.addIssue({ code: "custom", path: ["overrides", index], message: "INVALID_OVERRIDE_WINDOWS" });
    }
  });
});
export type ScheduleData = z.infer<typeof scheduleInput>;

// Local clock values only: no conversion through the browser's current zone.
export function minuteToTime(minute: number) {
  return `${Math.floor(minute / 60).toString().padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;
}
export function timeToMinute(time: string) {
  if (time === "24:00") return 1440;
  if (!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u.test(time)) return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour! * 60 + minute!;
}
