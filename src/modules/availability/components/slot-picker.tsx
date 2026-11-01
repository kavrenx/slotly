"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { availability as t } from "@/i18n/messages/ru/availability";
import { fieldClass, primaryButton } from "@/components/ui/form";
import { BookingSteps, MeetingSummary } from "@/components/booking/flow";
import styles from "@/components/booking/public-booking.module.css";
import { guestBooking } from "@/i18n/messages/ru/guest-booking";
import { GuestBookingForm, BookingSuccess } from "@/modules/guest-booking/components/booking-form";
import type { BookingReceipt } from "@/modules/guest-booking/contract";
import { addCalendarDays, dateInZone, isoWeekday } from "@/shared/calendar";
import type { AvailableSlot, AvailabilityResponse } from "../contract";
import { isNamedTimezone } from "../validation";

function browserTimezone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isNamedTimezone(zone) ? zone : "UTC";
}
function subscribeToTimezone(listener: () => void) {
  window.addEventListener("focus", listener);
  return () => window.removeEventListener("focus", listener);
}
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
function moveMonth(date: string, direction: number) {
  const value = new Date(`${monthStart(date)}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + direction);
  return value.toISOString().slice(0, 10);
}
const civilLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
type Loaded = { key: string; data: AvailabilityResponse | null; error: string };

export function SlotPicker({ publicId, organizerTimezone, serverNow, timezones }: { publicId: string; organizerTimezone: string; serverNow: string; timezones: string[] }) {
  const router = useRouter();
  const [bookingFlow, setBookingFlow] = useState<{ slot: AvailableSlot; timezone: string } | null>(null);
  const [receipt, setReceipt] = useState<BookingReceipt | null>(null);
  const [contact, setContact] = useState({ name: "", email: "" });
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const focusOnReturn = useRef(false);
  const detected = useSyncExternalStore(subscribeToTimezone, browserTimezone, () => organizerTimezone);
  const [preferredZone, setPreferredZone] = useState<string | null>(null);
  const timezone = preferredZone ?? detected;
  const [choice, setChoice] = useState<string | null>(null);
  const [monthChoice, setMonthChoice] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selection, setSelection] = useState<{ key: string; startAt: string } | null>(null);
  const metadata = loaded?.data?.timezone === timezone ? loaded.data : null;
  const today = dateInZone(loaded?.data?.generatedAt ?? serverNow, timezone);
  const firstDate = metadata?.range?.firstDate ?? today;
  const lastDate = metadata?.range?.lastDate ?? addCalendarDays(today, 365);
  const date = choice ?? firstDate;
  const month = monthChoice ?? monthStart(date);
  const key = `${publicId}|${timezone}|${date}|${refresh}`;
  const pending = loaded?.key !== key;
  const current = loaded?.key === key ? loaded : null;
  const slots = current?.data?.slots ?? [];
  const selected = selection?.key === key ? slots.find((slot) => slot.startAt === selection.startAt) : undefined;

  useEffect(() => {
    if (!bookingFlow && !receipt && focusOnReturn.current) { heading.current?.focus(); focusOnReturn.current = false; }
  }, [bookingFlow, receipt]);

  useEffect(() => {
    if (bookingFlow || receipt) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ date, timezone });
    void fetch(`/api/availability/${publicId}?${params}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(t.errors[body.code as string] ?? t.errors.SERVICE_UNAVAILABLE);
      if (!controller.signal.aborted) setLoaded({ key, data: body as AvailabilityResponse, error: "" });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoaded({ key, data: null, error: error instanceof Error && Object.values(t.errors).includes(error.message) ? error.message : t.errors.SERVICE_UNAVAILABLE ?? "Попробуйте ещё раз." });
    });
    return () => controller.abort();
  }, [publicId, date, timezone, key, bookingFlow, receipt]);

  const firstCell = addCalendarDays(month, 1 - isoWeekday(month));
  const days = Array.from({ length: 42 }, (_, index) => addCalendarDays(firstCell, index));
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const offset = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, timeZoneName: "shortOffset" });
  const labels = slots.map((slot) => time.format(new Date(slot.startAt)));
  const repeats = new Set(labels.filter((label, index) => labels.indexOf(label) !== index));
  const offsetAt = (at: string) => offset.formatToParts(new Date(at)).find((part) => part.type === "timeZoneName")?.value ?? "";
  const showOffsets = current?.data?.hasOffsetChange || repeats.size > 0;
  function chooseDate(value: string) { setChoice(value); setMonthChoice(monthStart(value)); setSelection(null); }
  function returnToCalendar() { focusOnReturn.current = true; setBookingFlow(null); setReceipt(null); setSelection(null); setRefresh((value) => value + 1); router.refresh(); }
  if (receipt) return <BookingSuccess receipt={receipt} onAnother={returnToCalendar} />;
  if (bookingFlow) return <GuestBookingForm publicId={publicId} slot={bookingFlow.slot} timezone={bookingFlow.timezone} initialContact={contact} onContactChange={setContact} onBack={returnToCalendar} onSuccess={(saved) => { setReceipt(saved); setBookingFlow(null); setContact({ name: "", email: "" }); }} />;
  return <section aria-labelledby="slot-picker-title" className={styles.panel}>
    <BookingSteps step={0} />
    <div className={styles.headingRow}><h2 ref={heading} tabIndex={-1} id="slot-picker-title">{t.heading}</h2><button type="button" disabled={pending} className={styles.refresh} onClick={() => setRefresh((value) => value + 1)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.5 7a7.5 7.5 0 0 1 12.7-1L20 8M4 16l1.8 2A7.5 7.5 0 0 0 18.5 17" /></svg>{t.refresh}</button></div>
    <p className={styles.description}>{t.description}</p>
    <div className={styles.zone}><label htmlFor="viewer-timezone" className={styles.zoneLabel}>{t.timezone}{slots[0] && <span>{offsetAt(selected?.startAt ?? slots[0].startAt)}</span>}</label>
    <select id="viewer-timezone" className={fieldClass} value={timezone} onChange={(event) => { setPreferredZone(event.target.value); setChoice(null); setMonthChoice(null); setSelection(null); }}>
      {[...new Set([timezone, organizerTimezone, ...timezones])].map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
    </select></div>
    <div className={styles.calendarLayout}>
      <div className="min-w-0">
        <div className={styles.calendarHeading}>
          <h3 aria-live="polite">{civilLabel(month, { month: "long", year: "numeric" })}</h3>
          <div className={styles.monthButtons}><button type="button" disabled={month <= monthStart(firstDate) || metadata?.range === null} aria-label={t.previousMonth} onClick={() => setMonthChoice(moveMonth(month, -1))}>←</button><button type="button" disabled={moveMonth(month, 1) > monthStart(lastDate) || metadata?.range === null} aria-label={t.nextMonth} onClick={() => setMonthChoice(moveMonth(month, 1))}>→</button></div>
        </div>
        <div role="group" aria-label={t.calendar} className={styles.calendar}>
          {t.week.map((day) => <span key={day} aria-hidden="true">{day}</span>)}
          {days.map((day) => {
            const sameMonth = monthStart(day) === month;
            const unavailable = !sameMonth || day < firstDate || day > lastDate || metadata?.range === null;
            return <button key={day} type="button" disabled={unavailable} aria-label={civilLabel(day, { day: "numeric", month: "long", year: "numeric", weekday: "long" })} aria-pressed={day === date} aria-current={day === today ? "date" : undefined}
              onClick={() => chooseDate(day)}>{Number(day.slice(-2))}</button>;
          })}
        </div>
        {metadata?.range && <p className={styles.range}>{t.range}: {civilLabel(firstDate, { day: "numeric", month: "short" })} — {civilLabel(lastDate, { day: "numeric", month: "short", year: "numeric" })}</p>}
      </div>
      <div className="min-w-0" aria-busy={pending}>
        <div className={styles.slotsHeading}><h3>{civilLabel(date, { weekday: "short", day: "numeric", month: "long" })}</h3>{!pending && !current?.error && slots.length > 0 && <span>{t.availableCount}: {slots.length}</span>}</div>
        {pending ? <div role="status"><p className="text-xs leading-6 text-muted">{t.loading}</p><div aria-hidden="true" className={styles.skeleton}>{[0, 1, 2, 3, 4, 5].map((index) => <div key={index} className="motion-safe:animate-pulse" />)}</div></div>
          : current?.error ? <p role="alert" className="text-sm leading-7 text-rose-800">{current.error}</p>
            : !slots.length ? <p role="status" className={styles.slotMessage}>{metadata?.range === null ? t.noDates : t.empty}</p>
              : <div role="group" aria-label={`Свободное время на ${date}`} className={styles.slots}>
                {slots.map((slot, index) => {
                  const label = labels[index]!;
                  const zoneOffset = offsetAt(slot.startAt);
                  return <button key={slot.startAt} ref={selected?.startAt === slot.startAt ? selectedButton : undefined} type="button" aria-pressed={selected?.startAt === slot.startAt} aria-label={`${label}${showOffsets ? ` ${zoneOffset}` : ""}`}
                    onClick={() => setSelection({ key, startAt: slot.startAt })}>{label}{showOffsets && <span>{zoneOffset}</span>}</button>;
                })}
              </div>}
      </div>
    </div>
    {selected && <div role="status" className={styles.selection}><span className="sr-only">{t.selected}</span><MeetingSummary slot={selected} timezone={timezone} /><button type="button" className={styles.change} onClick={() => { selectedButton.current?.focus(); setSelection(null); }}>{t.clear}</button></div>}
    <button type="button" disabled={!selected || pending} aria-describedby="selection-hint" className={primaryButton + " " + styles.continue} onClick={() => { if (selected) setBookingFlow({ slot: selected, timezone }); }}>{guestBooking.continue}</button>
    <p id="selection-hint" className={styles.note}>{selected ? t.notReserved : t.chooseFirst}</p>
  </section>;
}
