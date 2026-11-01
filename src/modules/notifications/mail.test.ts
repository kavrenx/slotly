import { expect, it } from "vitest";
import { renderBookingNotification, type NotificationContent } from "./mail";
import { renderMailHtml } from "../../server/mail/template";

function content(): NotificationContent {
  const at = new Date("2027-01-04T06:00:00Z");
  return {
    delivery: { id: "00000000-0000-4000-8000-000000000001", eventId: "00000000-0000-4000-8000-000000000002", audience: "guest", recipientEmail: "guest@example.invalid", recipientTimezone: "Europe/Minsk", organizerName: "Анна", attempts: 1, availableAt: at, leaseToken: null, lockedUntil: null, sentAt: null, failedAt: null, lastError: null, createdAt: at },
    event: { id: "00000000-0000-4000-8000-000000000002", bookingId: "00000000-0000-4000-8000-000000000003", organizerId: "00000000-0000-4000-8000-000000000004", version: 1, type: "created", actor: "guest", reason: null, requestId: null, requestHash: null, oldStartAt: null, oldEndAt: null, newStartAt: new Date("2027-01-04T20:45:00Z"), newEndAt: new Date("2027-01-04T21:15:00Z"), createdAt: at },
    booking: { id: "00000000-0000-4000-8000-000000000003", organizerId: "00000000-0000-4000-8000-000000000004", pageId: "00000000-0000-4000-8000-000000000005", occupancyId: "00000000-0000-4000-8000-000000000006", occupancyKind: "booking", guestName: "Мария", guestEmail: "guest@example.invalid", emailVerifiedAt: at, guestTimezone: "Europe/Minsk", locale: "ru", titleSnapshot: "Консультация", locationSnapshot: "Онлайн", scheduleTimezoneSnapshot: "Europe/Minsk", minNoticeMinutes: 120, horizonDays: 60, cancelCutoffMinutes: 120, rescheduleCutoffMinutes: 120, createdAt: at },
  };
}
it("shows both dates across midnight and a private fragment link without account registration", () => {
  const message = renderBookingNotification(content(), "http://localhost:3000", "s".repeat(64));
  expect(message.text).toContain("4 января 2027"); expect(message.text).toContain("5 января 2027");
  expect(message.text).toContain("23:45"); expect(message.text).toContain("00:15");
  expect(message.actionUrl).toMatch(/^http:\/\/localhost:3000\/manage#token=v1\./u);
  expect(message.text).toContain("Не публикуйте");
});
it("distinguishes the two instances of a repeated DST hour", () => {
  const c = content(); c.delivery.recipientTimezone = "America/New_York";
  c.event.newStartAt = new Date("2027-11-07T05:45:00Z"); c.event.newEndAt = new Date("2027-11-07T06:15:00Z");
  const message = renderBookingNotification(c, "http://localhost:3000", "s".repeat(64));
  expect(message.text).toContain("01:45 GMT-04:00"); expect(message.text).toContain("01:15 GMT-05:00");
});
it("keeps message identity and bytes stable across retries and includes event revision", () => {
  const c = content(); const first = renderBookingNotification(c, "http://localhost:3000", "s".repeat(64));
  c.delivery.attempts = 4; c.delivery.leaseToken = "00000000-0000-4000-8000-000000000007";
  expect(renderBookingNotification(c, "http://localhost:3000", "s".repeat(64))).toEqual(first);
  expect(first.messageId).toBe(c.delivery.id); expect(first.text).toContain("Изменение: 1");
});
it("keeps user content out of mail headers and gives organizers an authenticated link", () => {
  const c = content(); c.booking.titleSnapshot = "Встреча\r\nBcc: stranger@example.invalid\u0000"; c.delivery.audience = "organizer";
  const message = renderBookingNotification(c, "http://localhost:3000", "s".repeat(64));
  expect(message.subject).not.toContain("\n"); expect(message.subject).not.toContain("\r"); expect(message.subject).not.toContain("\u0000");
  expect(message.actionUrl).toContain("/dashboard/bookings/"); expect(message.text).not.toContain("#token=");
});
it.each(["created", "rescheduled", "cancelled"])("renders safe HTML for both audiences of %s using event time", type => {
  for (const audience of ["guest", "organizer"]) {
    const c = content(); c.event.type = type; c.delivery.audience = audience;
    c.event.oldStartAt = new Date("2027-01-03T10:00:00Z"); c.event.oldEndAt = new Date("2027-01-03T11:00:00Z");
    c.booking.locationSnapshot = '<img src="https://foreign.invalid/tracker">';
    const message = renderBookingNotification(c, "https://slotly.example", "s".repeat(64));
    const html = renderMailHtml(message, "https://slotly.example");
    expect(html).not.toContain("<img"); expect(html).toContain("&lt;img");
    expect(html).toContain(type === "cancelled" ? "60 мин" : "30 мин");
    expect(html.includes("#token=")).toBe(audience === "guest");
    expect(html).not.toContain("localhost"); expect(html).not.toContain("2027-01-04T");
  }
});
