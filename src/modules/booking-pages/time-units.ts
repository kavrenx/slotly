export const minuteUnits = { minutes: { label: "минуты", factor: 1 }, hours: { label: "часы", factor: 60 }, days: { label: "дни", factor: 1440 } } as const;
export type MinuteUnit = keyof typeof minuteUnits;
export function splitMinutes(minutes: number, unit: MinuteUnit) {
  const factor = minuteUnits[unit].factor;
  return { amount: Math.floor(minutes / factor), remainder: minutes % factor };
}
export function joinMinutes(amount: string, unit: MinuteUnit, remainder = 0): string {
  if (!/^\d+$/u.test(amount)) return "";
  const result = Number(amount) * minuteUnits[unit].factor + remainder;
  return Number.isSafeInteger(result) && result >= 0 ? String(result) : "";
}
export function preferredMinuteUnit(minutes: number, allowDays: boolean): MinuteUnit {
  return minutes > 0 && allowDays && minutes % 1440 === 0 ? "days" : minutes > 0 && minutes % 60 === 0 ? "hours" : "minutes";
}
export function minuteLabel(raw: string | number) {
  const minutes = raw === "" ? NaN : Number(raw);
  if (!Number.isSafeInteger(minutes) || minutes < 0) return "—";
  if (minutes === 0) return "0 мин";
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), rest = minutes % 60;
  return [days ? `${days} дн` : "", hours ? `${hours} ч` : "", rest ? `${rest} мин` : ""].filter(Boolean).join(" ");
}
