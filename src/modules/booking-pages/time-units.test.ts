import { expect, it } from "vitest";
import { joinMinutes, minuteLabel, preferredMinuteUnit, splitMinutes, type MinuteUnit } from "./time-units";
it("preserves every supported minute value when changing display units", () => {
  for (const unit of ["minutes", "hours", "days"] as MinuteUnit[]) for (let value = 0; value <= 43200; value++) {
    const { amount, remainder } = splitMinutes(value, unit);
    if (joinMinutes(String(amount), unit, remainder) !== String(value)) throw new Error(`Lost precision: ${value} ${unit}`);
  }
});
it("keeps non-divisible values and zero exact without floating point rounding", () => {
  expect(splitMinutes(121, "hours")).toEqual({ amount: 2, remainder: 1 });
  expect(joinMinutes("3", "hours", 1)).toBe("181");
  expect(joinMinutes("", "hours")).toBe(""); expect(joinMinutes("1.1", "hours")).toBe("");
  expect(joinMinutes("999999999999999999999", "days")).toBe("");
  expect(preferredMinuteUnit(43200, true)).toBe("days"); expect(preferredMinuteUnit(120, true)).toBe("hours"); expect(preferredMinuteUnit(0, true)).toBe("minutes");
});
it("formats rules without losing leftover hours or minutes", () => {
  expect(minuteLabel(1561)).toBe("1 дн 2 ч 1 мин"); expect(minuteLabel(0)).toBe("0 мин"); expect(minuteLabel("")).toBe("—");
});
