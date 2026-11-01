import { timeToMinute } from "./validation";
export function previewWorkingDay(windows: { start: string; end: string }[]) {
  const intervals = windows.map(window => ({ start: timeToMinute(window.start), end: timeToMinute(window.end) }));
  const invalid = intervals.some(window => window.start === null || window.end === null || window.start >= window.end);
  if (invalid) return { invalid: true, intervals: [] as { start: number; end: number }[] };
  const sorted = (intervals as { start: number; end: number }[]).toSorted((a, b) => a.start - b.start);
  if (sorted.some((window, index) => index > 0 && window.start < sorted[index - 1]!.end)) return { invalid: true, intervals: [] as { start: number; end: number }[] };
  return { invalid: false, intervals: sorted };
}
