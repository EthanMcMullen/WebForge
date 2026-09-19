import { accessFailure } from "@/lib/access";
import { NextRequest, NextResponse } from "next/server";
import { deleteApiJob, getApiJob, updateApiJobSettings } from "@/lib/store";
import { toApiJobResponse } from "@/lib/types";
import { UpdateApiJobInput } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/jobs/[id]">) {
  const denied = accessFailure(_request);
  if (denied) return denied;
  const { id } = await context.params;
  const job = await getApiJob(id);
  return job
    ? NextResponse.json({ job: toApiJobResponse(job) })
    : NextResponse.json({ error: "API job not found." }, { status: 404 });
}

export async function PATCH(request: NextRequest, context: RouteContext<"/api/jobs/[id]">) {
  const denied = accessFailure(request);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const input = UpdateApiJobInput.parse(await request.json());
    const job = await updateApiJobSettings(id, {
      name: input.name,
      refreshInterval: input.refresh_interval,
    });
    return NextResponse.json({ job: toApiJobResponse(job) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update API settings.";
    return NextResponse.json({ error: message }, { status: message === "API job not found." ? 404 : message.includes("is running") ? 409 : 400 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext<"/api/jobs/[id]">) {
  const denied = accessFailure(_request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    return await deleteApiJob(id)
      ? NextResponse.json({ deleted: true })
      : NextResponse.json({ error: "API job not found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete API." }, { status: 409 });
  }
}