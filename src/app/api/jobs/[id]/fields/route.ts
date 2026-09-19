import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { confirmApiJobFields, getApiJob } from "@/lib/store";
import { toApiJobResponse } from "@/lib/types";
import { ConfirmApiJobFieldsInput } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const existing = getApiJob(id);
  if (!existing) return NextResponse.json({ error: "API job not found." }, { status: 404 });
  if (existing.status !== "awaiting_fields") {
    return NextResponse.json({ error: "Field selection is closed for this job." }, { status: 409 });
  }
  try {
    const input = ConfirmApiJobFieldsInput.parse(await request.json());
    const job = confirmApiJobFields(id, input.selected_fields);
    return NextResponse.json({ job: toApiJobResponse(job) });
  } catch (error) {
    const message = error instanceof z.ZodError ? "Choose one to 19 proposed data fields." :
      error instanceof Error ? error.message : "Could not confirm fields.";
    const status = message === "Field selection is closed for this job." ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
