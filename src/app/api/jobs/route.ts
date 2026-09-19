import { accessFailure } from "@/lib/access";
import { NextRequest, NextResponse } from "next/server";
import { createApiJob } from "@/lib/pipeline";
import { listApiJobs } from "@/lib/store";
import { toApiJobResponse } from "@/lib/types";
import { CreateApiJobInput } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = accessFailure(request);
  if (denied) return denied;
  return NextResponse.json({ jobs: (await listApiJobs()).map(toApiJobResponse) });
}

export async function POST(request: NextRequest) {
  const denied = accessFailure(request);
  if (denied) return denied;
  try {
    const input = CreateApiJobInput.parse(await request.json());
    const job = await createApiJob(input);
    return NextResponse.json({ job: toApiJobResponse(job) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create API job." },
      { status: 400 },
    );
  }
}
