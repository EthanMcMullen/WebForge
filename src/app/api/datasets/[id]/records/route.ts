import { NextResponse } from "next/server";
import { getDataset, listRecords } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getDataset(id)) return NextResponse.json({ error: "Dataset not found." }, { status: 404 });
  return NextResponse.json({
    dataset_id: id,
    records: listRecords(id).map((record) => ({
      id: record.id, source_url: record.sourceUrl, data: record.data,
      field_status: record.fieldStatus, updated_at: record.updatedAt,
    })),
  });
}
