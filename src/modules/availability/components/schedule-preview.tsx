import { planning } from "@/i18n/messages/ru/planning";
import { previewWorkingDay } from "../schedule-preview";
import { minuteToTime } from "../validation";
import styles from "./schedule.module.css";
import { availability } from "@/i18n/messages/ru/availability";

export function SchedulePreview({ weekly, timezone, changed }: { weekly: { start: string; end: string }[][]; timezone: string; changed: boolean }) {
  return <aside className={styles.preview} aria-labelledby="working-week-title"><h2 id="working-week-title">Рабочая неделя</h2><p className={styles.previewZone}>{timezone}</p><p className={styles.previewCaption}>{changed ? "По текущим полям · не сохранено" : "По сохранённому расписанию"}</p><ol className={styles.previewDays}>{weekly.map((windows, day) => {
    const value = previewWorkingDay(windows);
    return <li key={day}><div className={styles.previewLabel}><span><span className={styles.fullDay}>{planning.weekdays[day]}</span><span className={styles.shortDay} aria-hidden="true">{availability.week[day]}</span></span><span>{value.invalid ? "Проверьте интервалы" : !windows.length ? "Выходной" : value.intervals.map(window => `${minuteToTime(window.start)}–${minuteToTime(window.end)}`).join(", ")}</span></div><div className={styles.bar} aria-hidden="true">{value.intervals.map((window, index) => <span key={index} style={{ left: `${window.start / 1440 * 100}%`, width: `${(window.end - window.start) / 1440 * 100}%` }} />)}</div></li>;
  })}</ol><p className={styles.previewNote}>Это рабочие часы, а не свободные слоты. Доступность зависит от занятости, буферов и правил страницы. Особые даты заменяют обычный день недели.</p></aside>;
}
