import { NextResponse } from "next/server";
import { refreshDataset } from "@/lib/pipeline";
import { getDataset } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getDataset(id)) return NextResponse.json({ error: "Dataset not found." }, { status: 404 });
  const result = await refreshDataset(id);
  return NextResponse.json(result);
}
