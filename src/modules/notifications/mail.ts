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
  const format = new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "longOffset" });
  // Format both endpoints fully: meetings can cross midnight or a DST boundary.
  return `${format.format(start)} — ${format.format(end)} · ${timezone}`;
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
  const lines = [heading, "", `${t.title}: ${line(b.titleSnapshot)}`,
    `${t.organizerLabel}: ${line(d.organizerName)}`, `${t.guestLabel}: ${line(b.guestName)}`];
  if (audience === "organizer") lines.push(`Email: ${line(b.guestEmail)}`);
  if (type === "rescheduled") lines.push("", `${t.before}: ${meetingTime(e.oldStartAt, e.oldEndAt, d.recipientTimezone)}`, `${t.after}: ${meetingTime(e.newStartAt, e.newEndAt, d.recipientTimezone)}`);
  else lines.push("", `${type === "cancelled" ? t.cancelledTime : t.time}: ${meetingTime(type === "cancelled" ? e.oldStartAt : e.newStartAt, type === "cancelled" ? e.oldEndAt : e.newEndAt, d.recipientTimezone)}`);
  if (b.locationSnapshot) lines.push("", `${t.location}: ${b.locationSnapshot}`);
  if (e.reason) lines.push("", `${t.reason}: ${e.reason}`);
  if (type !== "created") lines.push(`${t.actor}: ${t.actors[e.actor as keyof typeof t.actors]}`);
  lines.push("", audience === "guest" ? t.guestAction : t.ownerAction, actionUrl);
  if (audience === "guest") lines.push(t.privateLink);
  lines.push("", `${t.reference}: ${b.id}`, `${t.event}: ${e.version}`, t.current, "", t.signature);
  return { to: d.recipientEmail, subject: `${heading} · ${line(b.titleSnapshot)}`, text: lines.join("\n"), actionUrl,
    messageId: d.id, createdAt: d.createdAt.toISOString() };
}
