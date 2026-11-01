"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fieldClass, FormNotice, primaryButton, secondaryButton } from "@/components/ui/form";
import { bookingManagement as t } from "@/i18n/messages/ru/booking-management";
import { dateInZone } from "@/shared/calendar";
import type { AvailabilityResponse, AvailableSlot } from "@/modules/availability/contract";
import { MeetingTime } from "@/modules/guest-booking/components/booking-form";
import { managementToken, type ManagedBooking } from "../contract";
import { CopyManagementLink } from "./management-link";

class ManagementError extends Error { constructor(public code: string) { super(t.errors[code] ?? t.errors.SERVICE_UNAVAILABLE); } }
async function request<T>(url: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { method: data === undefined ? "GET" : "POST", ...(data === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), cache: "no-store", ...(signal ? { signal } : {}) }); }
  catch (cause) { if (signal?.aborted) throw cause; throw new ManagementError("SERVICE_UNAVAILABLE"); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ManagementError(body?.code ?? "SERVICE_UNAVAILABLE"); return body as T;
}
function errorMessage(cause: unknown) { return cause instanceof ManagementError ? cause.message : t.errors.SERVICE_UNAVAILABLE!; }
const timeLabel = (instant: string, timezone: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" }).format(new Date(instant));

function History({ booking }: { booking: ManagedBooking }) {
  return <details className="mt-7 rounded-2xl border border-line p-5"><summary className="cursor-pointer text-sm font-medium">{t.history}</summary><ol className="mt-4 space-y-5">{booking.history.map(event => <li key={event.version} className="border-l-2 border-line pl-4"><p className="text-sm font-medium">{event.type === "created" ? t.created : event.type === "rescheduled" ? t.moved : t.cancelDone}</p><p className="mt-1 text-xs leading-6 text-muted">{timeLabel(event.at, booking.timezone)} · {event.actor === "organizer" ? t.organizer : event.actor === "guest" ? t.guest : "Slotly"}</p>{event.oldStartAt && <p className="mt-1 text-xs leading-6 text-muted">{timeLabel(event.oldStartAt, booking.timezone)}{event.newStartAt ? ` → ${timeLabel(event.newStartAt, booking.timezone)}` : ""}</p>}{event.reason && <p className="mt-2 text-sm leading-7 whitespace-pre-wrap wrap-break-word">{event.reason}</p>}</li>)}</ol></details>;
}
function ReschedulePicker({ booking, token, busy, onSelect, onBack }: { booking: ManagedBooking; token: string; busy: boolean; onSelect: (slot: AvailableSlot) => void; onBack: () => void }) {
  const [zone, setZone] = useState(booking.timezone); const [dateChoice, setDateChoice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; data: AvailabilityResponse | null; error: string } | null>(null);
  const [refresh, setRefresh] = useState(0); const [selected, setSelected] = useState<{ key: string; slot: AvailableSlot } | null>(null);
  const metadata = loaded?.data?.timezone === zone ? loaded.data : null;
  const date = dateChoice ?? metadata?.range?.firstDate ?? dateInZone(booking.generatedAt, zone);
  const key = `${zone}|${date}|${refresh}|${booking.version}`; const pending = loaded?.key !== key;
  const current = loaded?.key === key ? loaded : null;
  const choice = selected?.key === key ? selected.slot : null;
  useEffect(() => {
    const controller = new AbortController();
    void request<AvailabilityResponse>("/api/booking-management/slots", { token, date, timezone: zone }, controller.signal)
      .then(data => { if (!controller.signal.aborted) setLoaded({ key, data, error: "" }); })
      .catch(cause => { if (!controller.signal.aborted) setLoaded({ key, data: null, error: errorMessage(cause) }); });
    return () => controller.abort();
  }, [token, date, zone, key]);
  const zones = Array.from(new Set([booking.timezone, "UTC", ...Intl.supportedValuesOf("timeZone")]));
  return <div className="mt-6"><h2 className="text-xl font-medium">{t.choose}</h2><fieldset disabled={busy} className="mt-5 space-y-5"><label className="block text-sm font-medium">{t.timezone}<select className={fieldClass + " mt-2"} value={zone} onChange={event => { setZone(event.target.value); setDateChoice(null); }}>{zones.map(value => <option key={value}>{value}</option>)}</select></label><label className="block text-sm font-medium">{t.date}<input className={fieldClass + " mt-2"} type="date" required value={date} min={metadata?.range?.firstDate} max={metadata?.range?.lastDate} onChange={event => { if (event.target.value) setDateChoice(event.target.value); }} /></label>
    <div aria-busy={pending}>{pending ? <p role="status" className="text-sm text-muted">{t.loading}</p> : current?.error ? <FormNotice error={current.error} /> : !current?.data?.slots.length ? <p className="text-sm leading-7 text-muted">{t.empty}</p> : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label={t.available}>{current.data.slots.map(slot => <button type="button" key={slot.startAt} aria-pressed={choice?.startAt === slot.startAt} className={`min-h-11 rounded-xl border px-2 py-3 text-xs ${choice?.startAt === slot.startAt ? "border-accent bg-accent text-white" : "border-line hover:border-accent"}`} onClick={() => setSelected({ key, slot })}>{timeLabel(slot.startAt, zone)}</button>)}</div>}</div>
    {choice && <div className="rounded-xl bg-panel p-4"><MeetingTime slot={choice} timezone={zone} /><p className="mt-3 text-xs leading-6 text-muted">{t.notReserved}</p></div>}
    <button type="button" disabled={!choice || pending} className={primaryButton + " w-full"} onClick={() => { if (choice) onSelect(choice); }}>{busy ? t.saving : t.reschedule}</button>
    <div className="flex flex-wrap gap-3"><button type="button" className={secondaryButton} onClick={() => setRefresh(value => value + 1)}>{t.refreshSlots}</button><button type="button" className={secondaryButton} onClick={onBack}>{t.back}</button></div></fieldset></div>;
}
export function BookingManagement({ initial, token }: { initial: ManagedBooking; token?: string }) {
  const router = useRouter(); const organizer = !token;
  const [booking, setBooking] = useState(initial); const [mode, setMode] = useState<"view" | "cancel" | "reschedule">("view");
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [success, setSuccess] = useState("");
  const intent = useRef<{ payload: string; requestId: string } | null>(null);
  async function reload() {
    setBusy(true); setError(""); setSuccess("");
    try { setBooking(await request<ManagedBooking>(token ? "/api/booking-management/read" : `/api/organizer/bookings/${booking.id}`, token ? { token } : undefined)); setMode("view"); intent.current = null; }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function change(operation: "cancel" | "reschedule", fields: Record<string, unknown>) {
    if (busy) return; setBusy(true); setError(""); setSuccess("");
    const payload = JSON.stringify({ operation, version: booking.version, ...fields });
    if (intent.current?.payload !== payload) intent.current = { payload, requestId: crypto.randomUUID() };
    const body = { version: booking.version, ...fields, requestId: intent.current.requestId, ...(token ? { token } : {}) };
    try {
      const result = await request<ManagedBooking>(token ? `/api/booking-management/${operation}` : `/api/organizer/bookings/${booking.id}/cancel`, body);
      setBooking(result); setMode("view"); intent.current = null; setReason(""); setSuccess(operation === "cancel" ? t.cancelDone : t.movedDone); if (organizer) router.refresh();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <div className="max-w-3xl"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs font-semibold tracking-widest text-accent uppercase">{organizer ? t.ownerTitle : t.title}</p><span className="rounded-full bg-panel px-3 py-2 text-xs">{booking.status === "cancelled" ? t.cancelled : t.confirmed}</span></div><h1 className="mt-4 text-3xl font-medium tracking-tight wrap-break-word sm:text-4xl">{booking.title}</h1><MeetingTime slot={booking} timezone={booking.timezone} />
    <dl className="mt-6 grid gap-5 rounded-2xl border border-line p-5 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted">{t.organizer}</dt><dd className="mt-2 wrap-break-word">{booking.organizerName}</dd></div><div><dt className="text-xs text-muted">{t.guest}</dt><dd className="mt-2 wrap-break-word">{booking.guestName}<br />{booking.guestEmail}</dd></div>{booking.location && <div className="sm:col-span-2"><dt className="text-xs text-muted">{t.location}</dt><dd className="mt-2 leading-7 whitespace-pre-wrap wrap-break-word">{booking.location}</dd></div>}</dl>
    <div className="mt-5"><FormNotice error={error} success={success} />{error && <button type="button" disabled={busy} className={secondaryButton + " mt-3"} onClick={() => void reload()}>{t.refresh}</button>}</div>
    {mode === "view" && <><div className="mt-6 flex flex-wrap gap-3">{booking.canReschedule && token && <button type="button" disabled={busy} className={primaryButton} onClick={() => { setMode("reschedule"); setSuccess(""); }}>{t.reschedule}</button>}{booking.canCancel && <button type="button" disabled={busy} className={secondaryButton} onClick={() => { setMode("cancel"); setSuccess(""); }}>{t.cancel}</button>}<button type="button" disabled={busy} className={secondaryButton} onClick={() => void reload()}>{t.refresh}</button></div>
    {booking.status === "confirmed" && !organizer && <div className="mt-4 text-xs leading-7 text-muted"><p>{t.cancelBy} {timeLabel(booking.cancelDeadline, booking.timezone)}.</p><p>{t.rescheduleBy} {timeLabel(booking.rescheduleDeadline, booking.timezone)}.</p>{!booking.canCancel && !booking.canReschedule && <p>{t.restricted}</p>}</div>}{organizer && !booking.canCancel && <p className="mt-4 text-xs leading-7 text-muted">{t.ownerRestricted}</p>}</>}
    {mode === "cancel" && <form className="mt-6 space-y-5 rounded-2xl border border-line p-5" onSubmit={event => { event.preventDefault(); void change("cancel", { reason: reason.trim() }); }}><h2 className="text-xl font-medium">{t.cancelTitle}</h2><p className="text-sm leading-7 text-muted">{t.cancelHint}</p><label className="block text-sm font-medium">{organizer ? t.reason : t.optionalReason}<textarea required={organizer} maxLength={1000} disabled={busy} value={reason} rows={3} className={fieldClass + " mt-2"} onChange={event => setReason(event.target.value)} /></label><div className="flex flex-wrap gap-3"><button disabled={busy || (organizer && !reason.trim())} className={primaryButton}>{busy ? t.saving : t.cancel}</button><button type="button" disabled={busy} className={secondaryButton} onClick={() => setMode("view")}>{t.back}</button></div></form>}
    {mode === "reschedule" && token && <ReschedulePicker key={booking.version} booking={booking} token={token} busy={busy} onSelect={slot => void change("reschedule", slot)} onBack={() => setMode("view")} />}
    <div className="mt-7">{(token || booking.managementToken) && <><CopyManagementLink token={token ?? booking.managementToken!} /><p className="mt-2 text-xs leading-6 text-muted">{organizer ? t.ownerLinkHint : t.linkHint}</p></>}</div><History booking={booking} />
  </div>;
}
export function GuestManagement() {
  const [loaded, setLoaded] = useState<{ token: string; booking: ManagedBooking } | null>(null); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  useEffect(() => {
    let controller = new AbortController();
    function load() {
      controller.abort(); controller = new AbortController(); const signal = controller.signal;
      const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
      void Promise.resolve().then(async () => {
        if (signal.aborted) return;
        setLoaded(null); setError("");
        if (!token || !managementToken.safeParse(token).success) throw new ManagementError("NOT_FOUND");
        return { token, booking: await request<ManagedBooking>("/api/booking-management/read", { token }, signal) };
      }).then(value => { if (value && !signal.aborted) setLoaded(value); }).catch(cause => { if (!signal.aborted) setError(errorMessage(cause)); });
    }
    load(); window.addEventListener("hashchange", load);
    return () => { controller.abort(); window.removeEventListener("hashchange", load); };
  }, [retry]);
  if (loaded) return <BookingManagement key={loaded.token} initial={loaded.booking} token={loaded.token} />;
  return <div className="max-w-xl"><h1 className="text-3xl font-medium">{t.title}</h1>{error ? <><div className="mt-5"><FormNotice error={error} /></div><p className="mt-5 text-sm leading-7 text-muted">{t.missing}</p><button type="button" className={secondaryButton + " mt-5"} onClick={() => setRetry(value => value + 1)}>{t.refresh}</button></> : <p role="status" className="mt-5 text-sm text-muted">{t.loading}</p>}</div>;
}
