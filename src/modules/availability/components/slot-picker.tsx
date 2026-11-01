"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { availability as t } from "@/i18n/messages/ru/availability";
import { fieldClass, primaryButton, secondaryButton } from "@/components/ui/form";
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
  const selectedOffsetChanges = selected && offsetAt(selected.startAt) !== offsetAt(selected.endAt);
  function chooseDate(value: string) { setChoice(value); setMonthChoice(monthStart(value)); setSelection(null); }
  function returnToCalendar() { setBookingFlow(null); setReceipt(null); setSelection(null); setRefresh((value) => value + 1); router.refresh(); }
  if (receipt) return <BookingSuccess receipt={receipt} onAnother={returnToCalendar} />;
  if (bookingFlow) return <GuestBookingForm publicId={publicId} slot={bookingFlow.slot} timezone={bookingFlow.timezone} onBack={returnToCalendar} onSuccess={(saved) => { setReceipt(saved); setBookingFlow(null); }} />;
  return <section aria-labelledby="slot-picker-title" className="min-w-0 p-5 sm:p-8">
    <h2 id="slot-picker-title" className="text-xl font-medium tracking-tight sm:text-2xl">{t.heading}</h2><p className="mt-3 text-sm leading-7 text-muted">{t.description}</p>
    <label htmlFor="viewer-timezone" className="mt-5 block text-xs font-medium text-muted">{t.timezone}</label>
    <select id="viewer-timezone" className={fieldClass + " mt-2"} value={timezone} onChange={(event) => { setPreferredZone(event.target.value); setChoice(null); setMonthChoice(null); setSelection(null); }}>
      {[...new Set([timezone, organizerTimezone, ...timezones])].map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
    </select>
    <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(150px,0.7fr)]">
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 aria-live="polite" className="text-sm font-medium capitalize">{civilLabel(month, { month: "long", year: "numeric" })}</h3>
          <div className="flex gap-1"><button type="button" disabled={month <= monthStart(firstDate) || metadata?.range === null} aria-label={t.previousMonth} className="grid size-9 place-items-center rounded-lg hover:bg-panel disabled:opacity-30" onClick={() => setMonthChoice(moveMonth(month, -1))}>←</button><button type="button" disabled={moveMonth(month, 1) > monthStart(lastDate) || metadata?.range === null} aria-label={t.nextMonth} className="grid size-9 place-items-center rounded-lg hover:bg-panel disabled:opacity-30" onClick={() => setMonthChoice(moveMonth(month, 1))}>→</button></div>
        </div>
        <div role="group" aria-label={t.calendar} className="mt-3 grid grid-cols-7 gap-1">
          {t.week.map((day) => <span key={day} aria-hidden="true" className="pb-2 text-center text-[11px] text-muted">{day}</span>)}
          {days.map((day) => {
            const sameMonth = monthStart(day) === month;
            const unavailable = !sameMonth || day < firstDate || day > lastDate || metadata?.range === null;
            return <button key={day} type="button" disabled={unavailable} aria-label={civilLabel(day, { day: "numeric", month: "long", year: "numeric", weekday: "long" })} aria-pressed={day === date} aria-current={day === today ? "date" : undefined}
              className={`grid h-11 w-full place-items-center rounded-xl text-sm tabular-nums transition-colors disabled:cursor-default disabled:opacity-25 ${day === date ? "bg-accent font-semibold text-white" : day === today ? "bg-panel font-semibold text-accent hover:bg-line" : "hover:bg-panel"}`}
              onClick={() => chooseDate(day)}>{Number(day.slice(-2))}</button>;
          })}
        </div>
        {metadata?.range && <p className="mt-4 text-[11px] leading-6 text-muted">{t.range}: {civilLabel(firstDate, { day: "numeric", month: "short" })} — {civilLabel(lastDate, { day: "numeric", month: "short", year: "numeric" })}</p>}
      </div>
      <div className="min-w-0" aria-busy={pending}>
        <h3 className="mb-4 pt-2 text-sm font-medium capitalize">{civilLabel(date, { weekday: "short", day: "numeric", month: "long" })}</h3>
        {pending ? <div role="status"><p className="text-xs leading-6 text-muted">{t.loading}</p><div aria-hidden="true" className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-1">{[0, 1, 2, 3].map((index) => <div key={index} className="h-11 rounded-xl bg-panel motion-safe:animate-pulse" />)}</div></div>
          : current?.error ? <p role="alert" className="text-sm leading-7 text-rose-800">{current.error}</p>
            : !slots.length ? <p role="status" className="rounded-xl bg-panel p-4 text-xs leading-7 text-muted">{metadata?.range === null ? t.noDates : t.empty}</p>
              : <div role="group" aria-label={`Свободное время на ${date}`} className="grid max-h-[400px] grid-cols-2 gap-2 overflow-y-auto p-1 xl:grid-cols-1">
                {slots.map((slot, index) => {
                  const label = labels[index]!;
                  const zoneOffset = offsetAt(slot.startAt);
                  return <button key={slot.startAt} type="button" aria-pressed={selected?.startAt === slot.startAt} aria-label={`${label}${showOffsets ? ` ${zoneOffset}` : ""}`}
                    className={`min-h-11 rounded-xl border px-3 py-2.5 text-sm font-medium tabular-nums transition-colors ${selected?.startAt === slot.startAt ? "border-accent bg-accent text-white" : "border-accent/40 text-accent hover:border-accent hover:bg-accent/5"}`}
                    onClick={() => setSelection({ key, startAt: slot.startAt })}>{label}{showOffsets && <span className="mt-1 block text-[10px] font-normal">{zoneOffset}</span>}</button>;
                })}
              </div>}
      </div>
    </div>
    {selected && <div role="status" className="feedback-message-in mt-6 rounded-2xl border border-accent/25 bg-accent/5 p-4"><p className="text-xs font-medium text-accent">{t.selected}</p><p className="mt-2 text-sm font-medium capitalize">{new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date(selected.startAt))}</p><p className="mt-1 text-sm leading-7 tabular-nums">{time.format(new Date(selected.startAt))}{selectedOffsetChanges ? ` (${offsetAt(selected.startAt)})` : ""} — {dateInZone(selected.endAt, timezone) !== date ? `${civilLabel(dateInZone(selected.endAt, timezone), { day: "numeric", month: "short" })}, ` : ""}{time.format(new Date(selected.endAt))}{selectedOffsetChanges ? ` (${offsetAt(selected.endAt)})` : ""}</p><p className="mt-2 text-xs text-muted">{timezone} · {offsetAt(selected.startAt)}</p><p className="mt-3 text-xs leading-6 text-muted">{t.notReserved}</p><button type="button" className="mt-2 min-h-9 text-xs font-medium text-accent underline underline-offset-4" onClick={() => setSelection(null)}>{t.clear}</button></div>}
    {selected && <button type="button" className={primaryButton + " mt-4 w-full"} onClick={() => setBookingFlow({ slot: selected, timezone })}>{guestBooking.continue}</button>}
    <button type="button" disabled={pending} className={secondaryButton + " mt-6 w-full"} onClick={() => setRefresh((value) => value + 1)}>{t.refresh}</button>
  </section>;
}
