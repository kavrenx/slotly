"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookingSteps, MeetingSummary } from "@/components/booking/flow";
import styles from "@/components/booking/public-booking.module.css";
import { fieldClass, FormNotice, primaryButton, secondaryButton } from "@/components/ui/form";
import { guestBooking as t } from "@/i18n/messages/ru/guest-booking";
import type { AvailableSlot } from "@/modules/availability/contract";
import { requestCodeInput, type BookingReceipt, type CodeChallenge } from "../contract";
import { managementHref } from "@/modules/booking-management/contract";
import { CopyManagementLink } from "@/modules/booking-management/components/management-link";
import { bookingManagement } from "@/i18n/messages/ru/booking-management";
import { pastedGuestCode } from "../code-paste";

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

type Contact = { name: string; email: string };
export function GuestBookingForm({ publicId, slot, timezone, initialContact, onContactChange, onBack, onSuccess }: { publicId: string; slot: AvailableSlot; timezone: string; initialContact: Contact; onContactChange: (contact: Contact) => void; onBack: () => void; onSuccess: (receipt: BookingReceipt) => void }) {
  const [name, setName] = useState(initialContact.name); const [email, setEmail] = useState(initialContact.email); const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<CodeChallenge | null>(null);
  const [retryRequest, setRetryRequest] = useState<{ id: string; previous?: string } | null>(null);
  const [pendingOperation, setPendingOperation] = useState<"code" | "confirm" | null>(null); const [error, setError] = useState(""); const [unavailable, setUnavailable] = useState(false);
  const pending = pendingOperation !== null;
  const [now, setNow] = useState(() => Date.now()); const [limitedUntil, setLimitedUntil] = useState(0); const [confirmLimitedUntil, setConfirmLimitedUntil] = useState(0);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const resendSeconds = Math.max(0, Math.ceil((Math.max(challenge ? Date.parse(challenge.resendAt) : 0, limitedUntil) - now) / 1000));
  const expirySeconds = Math.max(0, Math.ceil(((challenge ? Date.parse(challenge.expiresAt) : 0) - now) / 1000));
  const confirmSeconds = Math.max(0, Math.ceil((confirmLimitedUntil - now) / 1000));
  function failed(cause: unknown, operation: "code" | "confirm" = "code") {
    const failure = cause instanceof GuestRequestError ? cause : new GuestRequestError("SERVICE_UNAVAILABLE");
    setError(failure.message);
    if (["SLOT_UNAVAILABLE", "CONDITIONS_CHANGED", "NOT_FOUND", "IDEMPOTENCY_CONFLICT"].includes(failure.code)) setUnavailable(true);
    if (failure.retryAfter > 0) (operation === "code" ? setLimitedUntil : setConfirmLimitedUntil)(Date.now() + failure.retryAfter * 1000);
  }
  async function send(resend = false) {
    if (pending || unavailable || resendSeconds > 0) return;
    const intent = retryRequest ?? { id: crypto.randomUUID(), ...(resend && challenge ? { previous: challenge.challengeId } : {}) };
    const input = { requestId: intent.id, ...(intent.previous ? { previousChallengeId: intent.previous } : {}), name, email, timezone, ...slot };
    const parsed = requestCodeInput.safeParse(input);
    if (!parsed.success) { setError(t.errors.INVALID_INPUT ?? "Проверьте поля."); return; }
    setPendingOperation("code"); setError(""); setRetryRequest(intent);
    try {
      const result = await request<CodeChallenge>(publicId, "code", parsed.data);
      setChallenge(result); setCode(""); setRetryRequest(null); setNow(Date.now());
    } catch (cause) { failed(cause); } finally { setPendingOperation(null); }
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!challenge || pending || unavailable || expirySeconds === 0 || now < confirmLimitedUntil) return;
    if (!/^[0-9]{6}$/u.test(code)) { setError(t.errors.INVALID_INPUT ?? "Введите шесть цифр."); return; }
    setPendingOperation("confirm"); setError("");
    try { onSuccess(await request<BookingReceipt>(publicId, "confirm", { challengeId: challenge.challengeId, code })); }
    catch (cause) { failed(cause, "confirm"); } finally { setPendingOperation(null); }
  }
  return <section className={styles.panel} aria-labelledby="guest-booking-title">
    <BookingSteps step={challenge ? 2 : 1} />
    <button type="button" disabled={pending} onClick={onBack} className={styles.back}>{t.back}</button>
    <div className={styles.headingRow}><h2 id="guest-booking-title">{challenge ? t.codeHeading : t.contactHeading}</h2></div>
    <div className={styles.recap}>{challenge && <p className={styles.recapTitle}>{challenge.quote.title}</p>}<MeetingSummary slot={slot} timezone={timezone} /></div>
    <div className="mt-4"><FormNotice error={error} /></div>
    {!challenge ? <form key="contacts" className={styles.form} aria-busy={pending} onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <fieldset disabled={pending || unavailable} className={styles.fields}>
        <label htmlFor="guest-name">{t.name}<input autoFocus id="guest-name" autoComplete="name" required maxLength={100} value={name} className={fieldClass + " mt-2"} onChange={(event) => { setName(event.target.value); onContactChange({ name: event.target.value, email }); setRetryRequest(null); setError(""); }} /></label>
        <label htmlFor="guest-email">{t.email}<input id="guest-email" type="email" autoComplete="email" required maxLength={254} value={email} className={fieldClass + " mt-2"} onChange={(event) => { setEmail(event.target.value); onContactChange({ name, email: event.target.value }); setRetryRequest(null); setError(""); }} /></label>
        <p className={styles.note}>{t.contactHint}</p>
      </fieldset>
      <button disabled={pending || unavailable || resendSeconds > 0} className={primaryButton + " w-full"}>{pending ? t.sending : resendSeconds > 0 ? `${t.resendIn} ${resendSeconds} с` : t.send}</button>
    </form> : <div key="confirmation" className={styles.confirmation}>
      <p role="status" className={styles.sent}>{t.sent} <span>{email.trim().toLowerCase()}</span>.</p>
      <form onSubmit={confirm} className={styles.form} aria-busy={pending}>
        <label htmlFor="guest-code" className={styles.codeLabel}>{t.code}<input autoFocus id="guest-code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} disabled={pending || unavailable} aria-describedby="guest-code-expiry" className={fieldClass + " " + styles.code} onPaste={(event) => { event.preventDefault(); const pasted = pastedGuestCode(event.clipboardData.getData("text")); if (pasted !== null) { setCode(pasted); setError(""); } else { setError(t.pasteHint); } }} onChange={(event) => { setCode(event.target.value.replace(/\s/gu, "").slice(0, 6)); setError(""); }} /></label>
        <p id="guest-code-expiry" role="timer" aria-live="off" className={styles.timer}>{expirySeconds > 0 ? <>{t.expires} <span>{Math.floor(expirySeconds / 60)}:{String(expirySeconds % 60).padStart(2, "0")}</span></> : t.expired}</p>
        <details className={styles.rules}><summary>{t.rules}</summary><div>{challenge.quote.location && <p className="whitespace-pre-wrap wrap-break-word">{challenge.quote.location}</p>}<p>Длительность: {challenge.quote.durationMinutes} мин.</p><p>Отмена: {cutoff(challenge.quote.cancelCutoffMinutes)}.</p><p>Перенос: {cutoff(challenge.quote.rescheduleCutoffMinutes)}.</p></div></details>
        <p className={styles.note}>{t.notReserved}</p><button disabled={pending || unavailable || expirySeconds === 0 || now < confirmLimitedUntil} className={primaryButton + " w-full"}>{pendingOperation === "confirm" ? t.confirming : confirmSeconds > 0 ? `${t.confirmIn} ${confirmSeconds} с` : t.confirm}</button>
      </form>
      <div className={styles.codeActions}><button type="button" disabled={pending || unavailable || resendSeconds > 0} onClick={() => void send(true)}>{pendingOperation === "code" ? t.sending : resendSeconds > 0 ? `${t.resendIn} ${resendSeconds} с` : t.resend}</button>
      <button type="button" disabled={pending || unavailable} onClick={() => { setChallenge(null); setRetryRequest(null); setCode(""); setError(""); }}>{t.changeEmail}</button></div>
    </div>}
  </section>;
}

export function BookingSuccess({ receipt, onAnother }: { receipt: BookingReceipt; onAnother: () => void }) {
  const title = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { title.current?.focus(); }, []);
  return <section className={styles.panel + " " + styles.success} aria-labelledby="booking-success-title"><BookingSteps step={3} /><div aria-hidden="true" className={styles.successIcon}>{receipt.status === "confirmed" ? "✓" : "−"}</div><h2 ref={title} tabIndex={-1} id="booking-success-title" className={styles.successTitle}>{receipt.status === "confirmed" ? t.success : "Запись отменена"}</h2><p className={styles.description}>{receipt.status === "confirmed" ? t.successText : "Эта встреча больше не занимает время в расписании."}</p>
    <div className={styles.successDetails}><h3>{receipt.title}</h3><MeetingSummary slot={receipt} timezone={receipt.timezone} /><dl><div><dt>{t.organizer}</dt><dd>{receipt.organizerName}</dd></div>{receipt.location && <div><dt>Место или способ связи</dt><dd className="whitespace-pre-wrap">{receipt.location}</dd></div>}</dl><details className={styles.reference}><summary>{t.guest} и {t.reference.toLowerCase()}</summary><p>{receipt.guestName}<br />{receipt.guestEmail}</p><p className="font-mono">{receipt.id}</p></details></div>
    <div className={styles.successActions}><a href={managementHref(receipt.managementToken)} className={primaryButton + " w-full"}>{bookingManagement.manage}</a><CopyManagementLink token={receipt.managementToken} /><p className={styles.note}>{bookingManagement.linkHint}</p></div>
    <button type="button" className={secondaryButton + " mt-5 w-full"} onClick={onAnother}>{t.another}</button>
  </section>;
}
