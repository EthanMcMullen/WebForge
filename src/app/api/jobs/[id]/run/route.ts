import { accessFailure } from "@/lib/access";
import { NextResponse } from "next/server";
import { enqueueApiRun, getApiJob } from "@/lib/store";
import { toApiJobResponse } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(_request: Request, context: RouteContext<"/api/jobs/[id]/run">) {
  const denied = accessFailure(_request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!await getApiJob(id)) return NextResponse.json({ error: "API job not found." }, { status: 404 });
  try {
    const job = await enqueueApiRun(id);
    return NextResponse.json({ job: toApiJobResponse(job) }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not run API job." }, { status: 409 });
  }
}
