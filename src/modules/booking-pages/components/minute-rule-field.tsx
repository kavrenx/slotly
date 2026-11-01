"use client";
import { useState } from "react";
import { fieldClass } from "@/components/ui/form";
import { joinMinutes, minuteLabel, minuteUnits, preferredMinuteUnit, splitMinutes, type MinuteUnit } from "../time-units";
import styles from "./pages.module.css";

export function MinuteRuleField({ id, label, value, max, step = 1, allowDays = true, onChange }: { id: string; label: string; value: string; max: number; step?: number; allowDays?: boolean; onChange: (value: string) => void }) {
  const [unit, setUnit] = useState<MinuteUnit>(() => preferredMinuteUnit(Number(value), allowDays));
  const number = value === "" ? NaN : Number(value);
  const valid = Number.isSafeInteger(number) && number >= 0;
  const parts = valid ? splitMinutes(number, unit) : { amount: "", remainder: 0 };
  return <div className={styles.ruleField}><label htmlFor={id}>{label}</label><div className={styles.unitInput}>
    <input id={id} type="number" inputMode="numeric" required min={0} max={Math.floor((max - parts.remainder) / minuteUnits[unit].factor)} step={unit === "minutes" ? step : 1} value={parts.amount} className={fieldClass} onChange={event => onChange(joinMinutes(event.target.value, unit, parts.remainder))} />
    <select aria-label={`Единицы: ${label}`} value={unit} className={fieldClass} onChange={event => setUnit(event.target.value as MinuteUnit)}>{(Object.keys(minuteUnits) as MinuteUnit[]).filter(key => allowDays || key !== "days").map(key => <option key={key} value={key}>{minuteUnits[key].label}</option>)}</select>
  </div><p className={styles.fieldHint}>{parts.remainder > 0 ? <>+ {parts.remainder} мин сохранено · <button type="button" onClick={() => setUnit("minutes")}>Задать в минутах</button></> : <>От 0 до {minuteLabel(max)}{step > 1 ? `, кратно ${step} мин` : ""}</>}</p></div>;
}
