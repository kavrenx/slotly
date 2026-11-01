"use client";
import { useEffect, useState, type FormEvent } from "react";
import { fieldClass, FormNotice, primaryButton, secondaryButton } from "@/components/ui/form";
import { guestBooking as t } from "@/i18n/messages/ru/guest-booking";
import type { AvailableSlot } from "@/modules/availability/contract";
import { requestCodeInput, type BookingReceipt, type CodeChallenge } from "../contract";
import { managementHref } from "@/modules/booking-management/contract";
import { CopyManagementLink } from "@/modules/booking-management/components/management-link";
import { bookingManagement } from "@/i18n/messages/ru/booking-management";

class GuestRequestError extends Error {
  constructor(public code: string, public retryAfter = 0) { super(t.errors[code] ?? t.errors.SERVICE_UNAVAILABLE); }
}
async function request<T>(publicId: string, operation: "code" | "confirm", body: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/guest-bookings/${publicId}/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new GuestRequestError("SERVICE_UNAVAILABLE"); }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new GuestRequestError(result?.code ?? "SERVICE_UNAVAILABLE", Number(response.headers.get("retry-after") ?? 0));
  return result as T;
}
export function MeetingTime({ slot, timezone }: { slot: AvailableSlot; timezone: string }) {
  const format = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" });
  return <p className="mt-2 text-sm leading-7 wrap-break-word">{format.format(new Date(slot.startAt))}<br /><span className="text-muted">до {format.format(new Date(slot.endAt))} · {timezone}</span></p>;
}
const cutoff = (minutes: number) => minutes === 0 ? "до начала встречи" : `не позднее чем за ${minutes % 60 === 0 ? `${minutes / 60} ч` : `${minutes} мин`}`;

export function GuestBookingForm({ publicId, slot, timezone, onBack, onSuccess }: { publicId: string; slot: AvailableSlot; timezone: string; onBack: () => void; onSuccess: (receipt: BookingReceipt) => void }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null);
  const [retryRequest, setRetryRequest] = useState<{ id: string; previous?: string } | null>(null);
  const [pending, setPending] = useState(false); const [error, setError] = useState(""); const [unavailable, setUnavailable] = useState(false);
  const [now, setNow] = useState(() => Date.now()); const [limitedUntil, setLimitedUntil] = useState(0); const [confirmLimitedUntil, setConfirmLimitedUntil] = useState(0);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const resendSeconds = Math.max(0, Math.ceil((Math.max(challenge ? Date.parse(challenge.resendAt) : 0, limitedUntil) - now) / 1000));
  const expirySeconds = Math.max(0, Math.ceil(((challenge ? Date.parse(challenge.expiresAt) : 0) - now) / 1000));
  function failed(cause: unknown, operation: "code" | "confirm" = "code") {
    const failure = cause instanceof GuestRequestError ? cause : new GuestRequestError("SERVICE_UNAVAILABLE");
    setError(failure.message);
    if (["SLOT_UNAVAILABLE", "CONDITIONS_CHANGED", "NOT_FOUND", "IDEMPOTENCY_CONFLICT"].includes(failure.code)) setUnavailable(true);
    if (failure.retryAfter > 0) (operation === "code" ? setLimitedUntil : setConfirmLimitedUntil)(Date.now() + failure.retryAfter * 1000);
  }
  async function send(resend = false) {
    if (pending || unavailable) return;
    const intent = retryRequest ?? { id: crypto.randomUUID(), ...(resend && challenge ? { previous: challenge.challengeId } : {}) };
    const input = { requestId: intent.id, ...(intent.previous ? { previousChallengeId: intent.previous } : {}), name, email, timezone, ...slot };
    const parsed = requestCodeInput.safeParse(input);
    if (!parsed.success) { setError(t.errors.INVALID_INPUT ?? "Проверьте поля."); return; }
    setPending(true); setError(""); setRetryRequest(intent);
    try {
      const result = await request<CodeChallenge>(publicId, "code", parsed.data);
      setChallenge(result); setCode(""); setRetryRequest(null); setNow(Date.now());
    } catch (cause) { failed(cause); } finally { setPending(false); }
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!challenge || pending || unavailable) return;
    if (!/^[0-9]{6}$/u.test(code)) { setError(t.errors.INVALID_INPUT ?? "Введите шесть цифр."); return; }
    setPending(true); setError("");
    try { onSuccess(await request<BookingReceipt>(publicId, "confirm", { challengeId: challenge.challengeId, code })); }
    catch (cause) { failed(cause, "confirm"); } finally { setPending(false); }
  }
  return <section className="min-w-0 p-5 sm:p-8" aria-labelledby="guest-booking-title">
    <button type="button" disabled={pending} onClick={onBack} className="min-h-10 text-xs font-medium text-muted hover:text-accent disabled:opacity-50">{t.back}</button>
    <p className="mt-4 text-xs font-semibold tracking-widest text-accent uppercase">{t.heading}</p><h2 id="guest-booking-title" className="mt-3 text-2xl font-medium tracking-tight">{challenge ? t.codeHeading : t.contactHeading}</h2>
    <div className="mt-5 rounded-2xl bg-panel p-4">{challenge && <p className="font-medium wrap-break-word">{challenge.quote.title}</p>}<MeetingTime slot={slot} timezone={timezone} /></div>
    <div className="mt-5"><FormNotice error={error} /></div>
    {!challenge ? <form className="mt-5 space-y-5" aria-busy={pending} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <fieldset disabled={pending || unavailable} className="space-y-5">
        <label htmlFor="guest-name" className="block text-sm font-medium">{t.name}<input autoFocus id="guest-name" autoComplete="name" required maxLength={100} value={name} className={fieldClass + " mt-2"} onChange={(event) => { setName(event.target.value); setRetryRequest(null); setError(""); }} /></label>
        <label htmlFor="guest-email" className="block text-sm font-medium">{t.email}<input id="guest-email" type="email" autoComplete="email" required maxLength={254} value={email} className={fieldClass + " mt-2"} onChange={(event) => { setEmail(event.target.value); setRetryRequest(null); setError(""); }} /></label>
        <p className="text-xs leading-6 text-muted">{t.contactHint}</p>
      </fieldset>
      <button disabled={pending || unavailable || resendSeconds > 0} className={primaryButton + " w-full"}>{pending ? t.sending : resendSeconds > 0 ? `${t.resendIn} ${resendSeconds} с` : t.send}</button>
    </form> : <>
      <p role="status" className="mt-5 text-sm leading-7 text-muted">{t.sent} <span className="font-medium wrap-break-word text-ink">{email.trim().toLowerCase()}</span>.</p>
      <form onSubmit={confirm} className="mt-5 space-y-5" aria-busy={pending}>
        <label htmlFor="guest-code" className="block text-sm font-medium">{t.code}<input autoFocus id="guest-code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} disabled={pending || unavailable} className={fieldClass + " mt-2 text-center text-2xl tracking-[0.4em] tabular-nums"} onChange={(event) => { setCode(event.target.value.replace(/\s/gu, "").slice(0, 6)); setError(""); }} /></label>
        <p className="text-xs text-muted">{t.expires} {Math.floor(expirySeconds / 60)}:{String(expirySeconds % 60).padStart(2, "0")}</p>
        <details className="rounded-xl border border-line p-4"><summary className="cursor-pointer text-xs font-medium">{t.rules}</summary><div className="mt-3 space-y-2 text-xs leading-6 text-muted">{challenge.quote.location && <p className="whitespace-pre-wrap wrap-break-word">{challenge.quote.location}</p>}<p>Длительность: {challenge.quote.durationMinutes} мин.</p><p>Отмена: {cutoff(challenge.quote.cancelCutoffMinutes)}.</p><p>Перенос: {cutoff(challenge.quote.rescheduleCutoffMinutes)}.</p></div></details>
        <p className="text-xs leading-6 text-muted">{t.notReserved}</p><button disabled={pending || unavailable || expirySeconds === 0 || now < confirmLimitedUntil} className={primaryButton + " w-full"}>{pending ? t.confirming : t.confirm}</button>
      </form>
      <button type="button" disabled={pending || unavailable || resendSeconds > 0} onClick={() => void send(true)} className={secondaryButton + " mt-4 w-full"}>{resendSeconds > 0 ? `${t.resendIn} ${resendSeconds} с` : t.resend}</button>
      <button type="button" disabled={pending || unavailable} onClick={() => { setChallenge(null); setRetryRequest(null); setCode(""); setError(""); }} className="mt-3 min-h-10 w-full text-xs text-muted underline underline-offset-4">{t.changeEmail}</button>
    </>}
  </section>;
}

export function BookingSuccess({ receipt, onAnother }: { receipt: BookingReceipt; onAnother: () => void }) {
  return <section className="min-w-0 p-6 sm:p-9" aria-labelledby="booking-success-title"><div aria-hidden="true" className="grid size-14 place-items-center rounded-full bg-accent/10 text-2xl text-accent">✓</div><h2 id="booking-success-title" className="mt-6 text-3xl font-medium tracking-tight">{receipt.status === "confirmed" ? t.success : "Запись отменена"}</h2><p className="mt-4 text-sm leading-7 text-muted">{receipt.status === "confirmed" ? t.successText : "Эта встреча больше не занимает время в расписании."}</p>
    <div className="mt-6 rounded-2xl border border-line p-5"><h3 className="text-xl font-medium wrap-break-word">{receipt.title}</h3><MeetingTime slot={receipt} timezone={receipt.timezone} /><dl className="mt-5 space-y-4 text-sm"><div><dt className="text-xs text-muted">{t.organizer}</dt><dd className="mt-1 wrap-break-word">{receipt.organizerName}</dd></div><div><dt className="text-xs text-muted">{t.guest}</dt><dd className="mt-1 wrap-break-word">{receipt.guestName}<br />{receipt.guestEmail}</dd></div>{receipt.location && <div><dt className="text-xs text-muted">Место или способ связи</dt><dd className="mt-1 whitespace-pre-wrap wrap-break-word">{receipt.location}</dd></div>}<div><dt className="text-xs text-muted">{t.reference}</dt><dd className="mt-1 font-mono text-xs wrap-break-word">{receipt.id}</dd></div></dl></div>
    <div className="mt-6 space-y-4"><a href={managementHref(receipt.managementToken)} className={primaryButton + " w-full"}>{bookingManagement.manage}</a><CopyManagementLink token={receipt.managementToken} /><p className="text-xs leading-6 text-muted">{bookingManagement.linkHint}</p></div>
    <button type="button" className={secondaryButton + " mt-6 w-full"} onClick={onAnother}>{t.another}</button>
  </section>;
}
