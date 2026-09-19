import { accessFailure } from "@/lib/access";
import { NextResponse } from "next/server";
import { getApiJob } from "@/lib/store";
import { runApiJob } from "@/lib/pipeline";
import { toApiJobResponse } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(_request: Request, context: RouteContext<"/api/jobs/[id]/refresh">) {
  const denied = accessFailure(_request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!getApiJob(id)) return NextResponse.json({ error: "API job not found." }, { status: 404 });
  try {
    const job = await runApiJob(id);
    return NextResponse.json({ job: toApiJobResponse(job) }, { status: job.status === "failed" ? 502 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not refresh API job." }, { status: 409 });
  }
}