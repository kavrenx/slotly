import { guestBookingRoute } from "@/modules/guest-booking/server";
export async function POST(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  return guestBookingRoute(request, (await params).publicId, "confirm");
}
