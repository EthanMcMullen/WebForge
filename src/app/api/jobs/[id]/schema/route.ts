import { NextResponse } from "next/server";
import { getApiJob } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/jobs/[id]/schema">) {
  const { id } = await context.params;
  const job = getApiJob(id);
  if (!job) return NextResponse.json({ error: "API job not found." }, { status: 404 });
  return NextResponse.json({ job_id: job.id, name: job.name, schema: job.schema });
}
