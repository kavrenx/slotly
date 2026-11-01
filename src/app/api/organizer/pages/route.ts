import { planningRoute } from "@/modules/organizers/server";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return planningRoute(request, { kind: "pages" }); }
export function POST(request: Request) { return planningRoute(request, { kind: "pages" }); }
