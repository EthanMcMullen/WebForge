import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  const missing = ["OPENAI_API_KEY", "BROWSERBASE_API_KEY"].filter((key) => !process.env[key]);
  return NextResponse.json({ liveReady: missing.length === 0, jevReady: Boolean(process.env.TYPESAFE_API_KEY), missing });
}
