import { NextResponse } from "next/server";
import { getRecord } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; recordId: string }> }) {
  const { id, recordId } = await context.params;
  const record = getRecord(id, recordId);
  if (!record) return NextResponse.json({ error: "Record not found." }, { status: 404 });
  return NextResponse.json({ dataset_id: id, record_id: recordId, source_url: record.sourceUrl, evidence: record.evidence });
}
