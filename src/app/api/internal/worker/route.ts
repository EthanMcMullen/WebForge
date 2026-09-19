import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { claimNextRun, enqueueDueRefreshes } from "@/lib/store";
import { runApiJob } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const expected = process.env.WEBFORGE_WORKER_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /i, "") || "";
  if (!expected || !supplied || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const scheduled = enqueueDueRefreshes();
  const run = claimNextRun();
  if (!run) return NextResponse.json({ scheduled, ran: false });
  const job = await runApiJob(run.jobId, undefined, undefined, undefined, { id: run.id, trigger: run.trigger });
  return NextResponse.json({ scheduled, ran: true, job_id: job.id, outcome: job.runSummary?.outcome });
}
