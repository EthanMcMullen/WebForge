import { NextResponse } from "next/server";
import { getDataset } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dataset = getDataset(id);
  if (!dataset) return NextResponse.json({ error: "Dataset not found." }, { status: 404 });
  return NextResponse.json({ dataset_id: id, name: dataset.name, fields: dataset.fields });
}
