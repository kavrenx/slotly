import { guestBooking as t } from "@/i18n/messages/ru/guest-booking";
import { meetingTimeSummary } from "@/shared/meeting-time";
import type { AvailableSlot } from "@/modules/availability/contract";
import styles from "./public-booking.module.css";

export function BookingSteps({ step }: { step: 0 | 1 | 2 | 3 }) {
  return <ol role="list" className={styles.steps} aria-label={t.stepsLabel}>{t.steps.map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} data-state={index < step ? "done" : index === step ? "current" : "waiting"}>{index > 0 && <span aria-hidden="true">›</span>}{label}</li>)}</ol>;
}
export function MeetingSummary({ slot, timezone }: { slot: AvailableSlot; timezone: string }) {
  const value = meetingTimeSummary(slot, timezone);
  return <div className={styles.meetingTime}><p className={styles.date}>{value.date}</p><p className={styles.clock}>{value.time}</p><p className={styles.timeMeta}><span>{value.durationMinutes} {t.minutes}</span><span>{timezone} · {value.offset}</span></p></div>;
}
