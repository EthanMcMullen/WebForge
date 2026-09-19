import { accessFailure } from "@/lib/access";
import { NextResponse } from "next/server";
import { requestRunCancellation } from "@/lib/store";
import { toApiJobResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext<"/api/jobs/[id]/cancel">) {
  const denied = accessFailure(request);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    return NextResponse.json({ job: toApiJobResponse(await requestRunCancellation(id)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not cancel run." }, { status: 409 });
  }
}
