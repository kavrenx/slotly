import { planningRoute } from "@/modules/organizers/server";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return planningRoute(request, { kind: "schedule" }); }
export function PUT(request: Request) { return planningRoute(request, { kind: "schedule" }); }
