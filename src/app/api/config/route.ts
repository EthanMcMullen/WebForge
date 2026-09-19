import { NextResponse } from "next/server";
export const runtime = "nodejs";
export function GET() {
  const missing = ["OPENAI_API_KEY", "FIRECRAWL_API_KEY"].filter((key) => !process.env[key]);
  return NextResponse.json({ planner_ready: Boolean(process.env.OPENAI_API_KEY), extraction_ready: Boolean(process.env.FIRECRAWL_API_KEY), missing });
}