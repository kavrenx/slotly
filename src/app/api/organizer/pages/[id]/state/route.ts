import { planningRoute } from "@/modules/organizers/server";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return planningRoute(request, { kind: "state", id: (await params).id });
}
