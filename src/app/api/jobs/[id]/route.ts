import { NextResponse } from "next/server";
import { getApiJob } from "@/lib/store";
import { toApiJobResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/jobs/[id]">) {
  const { id } = await context.params;
  const job = getApiJob(id);
  return job
    ? NextResponse.json({ job: toApiJobResponse(job) })
    : NextResponse.json({ error: "API job not found." }, { status: 404 });
}
