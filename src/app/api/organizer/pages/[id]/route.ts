import { planningRoute } from "@/modules/organizers/server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) { return planningRoute(request, { kind: "page", id: (await params).id }); }
export async function PUT(request: Request, { params }: Context) { return planningRoute(request, { kind: "page", id: (await params).id }); }
