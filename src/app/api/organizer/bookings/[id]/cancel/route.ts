import { organizerBookingRoute } from "@/modules/booking-management/server";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return organizerBookingRoute(request, (await context.params).id, "cancel"); }
