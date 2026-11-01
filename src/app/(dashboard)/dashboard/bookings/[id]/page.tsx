import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrganizer } from "@/modules/organizers/server";
import { BookingManagement } from "@/modules/booking-management/components/management";
import { getManagedBooking } from "@/modules/booking-management/service";
import { managementDependencies } from "@/modules/booking-management/server";
import { DomainError } from "@/shared/domain-error";
export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOrganizer(); const { id } = await params;
  let booking;
  try { booking = await getManagedBooking(managementDependencies(), { kind: "organizer", organizerId: owner.id, bookingId: id }); }
  catch (error) { if (error instanceof DomainError && error.status === 404) notFound(); throw error; }
  return <><Link href="/dashboard/bookings" className="mb-7 inline-block text-sm text-muted underline underline-offset-4">← Все записи</Link><BookingManagement initial={booking} /></>;
}
