import { accessFailure } from "@/lib/access";
import { NextResponse } from "next/server";
import { getApiJob, listApiJobRuns } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext<"/api/jobs/[id]/runs">) {
  const denied = accessFailure(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!await getApiJob(id)) return NextResponse.json({ error: "API job not found." }, { status: 404 });
  return NextResponse.json({ runs: await listApiJobRuns(id) });
}
