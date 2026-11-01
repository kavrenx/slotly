import type { LocalMail } from "../../server/mail/local";
import type { bookingEvents, bookings, notificationOutbox } from "../../server/db/schema";
import { notificationMessages as t } from "../../i18n/messages/ru/notifications";
import { createManagementToken } from "../booking-management/token";

export type NotificationContent = {
  delivery: typeof notificationOutbox.$inferSelect;
  event: typeof bookingEvents.$inferSelect;
  booking: typeof bookings.$inferSelect;
};
const line = (value: string) => Array.from(value, char => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127 ? " " : char).join("").trim();
function meetingTime(start: Date | null, end: Date | null, timezone: string) {
  if (!start || !end) throw new Error("Missing event interval");
  const date = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, year: "numeric", month: "long", day: "numeric" });
  const clock = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const zone = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, timeZoneName: "longOffset" });
  const offset = (value: Date) => zone.formatToParts(value).find(p => p.type === "timeZoneName")!.value;
  const first = offset(start), last = offset(end);
  if (date.format(start) === date.format(end)) return `${date.format(start)} · ${clock.format(start)}${first !== last ? ` ${first}` : ""} — ${clock.format(end)} ${last} · ${timezone}`;
  return `${date.format(start)} · ${clock.format(start)} ${first} — ${date.format(end)} · ${clock.format(end)} ${last} · ${timezone}`;
}
export function renderBookingNotification(content: NotificationContent, appUrl: string, secret: string): LocalMail {
  const { delivery: d, event: e, booking: b } = content;
  const audience = d.audience as "guest" | "organizer";
  const type = e.type as "created" | "rescheduled" | "cancelled";
  const heading = t[audience][type];
  if (!heading) throw new Error("Unknown notification type");
  const actionUrl = audience === "guest"
    ? `${appUrl}/manage#token=${createManagementToken(secret, b)}`
    : `${appUrl}/dashboard/bookings/${b.id}`;
  const start = type === "cancelled" ? e.oldStartAt : e.newStartAt;
  const end = type === "cancelled" ? e.oldEndAt : e.newEndAt;
  if (!start || !end) throw new Error("Missing event interval");
  const duration = `${(end.getTime() - start.getTime()) / 60_000} мин`;
  const lines = [heading, "", `${t.title}: ${line(b.titleSnapshot)}`,
    `${t.organizerLabel}: ${line(d.organizerName)}`, `${t.guestLabel}: ${line(b.guestName)}`];
  if (audience === "organizer") lines.push(`Email: ${line(b.guestEmail)}`);
  if (type === "rescheduled") lines.push("", `${t.before}: ${meetingTime(e.oldStartAt, e.oldEndAt, d.recipientTimezone)}`, `${t.after}: ${meetingTime(e.newStartAt, e.newEndAt, d.recipientTimezone)}`);
  else lines.push("", `${type === "cancelled" ? t.cancelledTime : t.time}: ${meetingTime(type === "cancelled" ? e.oldStartAt : e.newStartAt, type === "cancelled" ? e.oldEndAt : e.newEndAt, d.recipientTimezone)}`);
  lines.push(`Длительность: ${duration}`);
  if (b.locationSnapshot) lines.push("", `${t.location}: ${b.locationSnapshot}`);
  if (e.reason) lines.push("", `${t.reason}: ${e.reason}`);
  if (type !== "created") lines.push(`${t.actor}: ${t.actors[e.actor as keyof typeof t.actors]}`);
  lines.push("", audience === "guest" ? t.guestAction : t.ownerAction, actionUrl);
  if (audience === "guest") lines.push(t.privateLink);
  lines.push("", `${t.reference}: ${b.id}`, `${t.event}: ${e.version}`, t.current, "", t.signature);
  const details = [{ label: t.title, value: b.titleSnapshot }, { label: type === "cancelled" ? t.cancelledTime : type === "rescheduled" ? t.after : t.time, value: meetingTime(start, end, d.recipientTimezone) },
    { label: "Длительность", value: duration }, { label: t.organizerLabel, value: d.organizerName }, { label: t.guestLabel, value: audience === "organizer" ? `${b.guestName} · ${b.guestEmail}` : b.guestName }];
  if (type === "rescheduled") details.push({ label: t.before, value: meetingTime(e.oldStartAt, e.oldEndAt, d.recipientTimezone) });
  if (b.locationSnapshot) details.push({ label: t.location, value: b.locationSnapshot });
  if (e.reason) details.push({ label: t.reason, value: e.reason });
  if (type !== "created") details.push({ label: t.actor, value: t.actors[e.actor as keyof typeof t.actors] });
  return { to: d.recipientEmail, subject: `${heading} · ${line(b.titleSnapshot)}`, text: lines.join("\n"), actionUrl,
    presentation: { heading: audience === "guest" && type === "created" ? "Встреча подтверждена" : heading,
      details, actionLabel: audience === "guest" ? "Управлять встречей" : "Открыть запись", notes: [...(audience === "guest" ? [t.privateLink] : []), t.current], reference: `${t.reference}: ${b.id} · ${t.event}: ${e.version}` },
    messageId: d.id, createdAt: d.createdAt.toISOString() };
}
