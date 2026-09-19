import { NextResponse } from "next/server";
import { getApiJob, listApiRecords } from "@/lib/store";
import { toApiRecordResponse } from "@/lib/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: RouteContext<"/api/jobs/[id]/records">) {
  const { id } = await context.params;
  const job = getApiJob(id);
  if (!job) return NextResponse.json({ error: "API job not found." }, { status: 404 });
  const records = listApiRecords(id).map(toApiRecordResponse);
  return NextResponse.json({ job_id: id, status: job.status, count: records.length, records });
}