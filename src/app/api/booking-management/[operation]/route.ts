import { guestManagementRoute } from "@/modules/booking-management/server";
import type { ManagementOperation } from "@/modules/booking-management/http";
export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  const { operation } = await context.params;
  if (!["read", "slots", "cancel", "reschedule"].includes(operation)) return Response.json({ code: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return guestManagementRoute(request, operation as ManagementOperation);
}
