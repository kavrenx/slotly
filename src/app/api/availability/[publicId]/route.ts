import { getDatabase } from "@/server/db/client";
import { handlePublicAvailability } from "@/modules/availability/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  return handlePublicAvailability(getDatabase(), request, (await params).publicId);
}
