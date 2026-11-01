import { z } from "zod";

export const bookingViews = ["upcoming", "past", "cancelled"] as const;
export type BookingView = typeof bookingViews[number];
export const bookingListInput = z.strictObject({
  view: z.enum(bookingViews).default("upcoming"),
  page: z.number().int().min(1).max(1_000_000).default(1),
});
export const BOOKINGS_PER_PAGE = 20;

// Repeated, unknown or oversized URL values fall back to the default view.
// The service also validates its own strict contract.
export function readBookingFilters(query: Record<string, string | string[] | undefined>) {
  const view = bookingViews.find(value => value === query.view) ?? "upcoming";
  const page = typeof query.page === "string" && /^[1-9]\d{0,6}$/u.test(query.page) ? Number(query.page) : 1;
  return { view, page: page <= 1_000_000 ? page : 1 };
}
export function bookingsHref(view: BookingView = "upcoming", page = 1) {
  const query = new URLSearchParams();
  if (view !== "upcoming") query.set("view", view);
  if (page > 1) query.set("page", String(page));
  return `/dashboard/bookings${query.size ? `?${query}` : ""}`;
}
