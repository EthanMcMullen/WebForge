import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  const missing = ["OPENAI_API_KEY"].filter((key) => !process.env[key]);
  return NextResponse.json({ planner_ready: missing.length === 0, missing });
}
