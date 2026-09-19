import { NextRequest, NextResponse } from "next/server";
import { createDataset } from "@/lib/pipeline";
import { listDatasets } from "@/lib/store";
import { CreateDatasetInput } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET() {
  return NextResponse.json({ datasets: listDatasets() });
}

export async function POST(request: NextRequest) {
  try {
    const body = CreateDatasetInput.parse(await request.json());
    if (body.mode === "live" && (!process.env.OPENAI_API_KEY || !process.env.BROWSERBASE_API_KEY)) {
      return NextResponse.json({ error: "Live mode requires OPENAI_API_KEY and BROWSERBASE_API_KEY." }, { status: 400 });
    }
    const dataset = await createDataset(body.prompt, body.mode, body.seedUrls);
    return NextResponse.json({ dataset }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create dataset." }, { status: 400 });
  }
}
