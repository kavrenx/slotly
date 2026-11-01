import { organizerBookingRoute } from "@/modules/booking-management/server";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return organizerBookingRoute(request, (await context.params).id, "read"); }
