import { accessFailure } from "@/lib/access";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  const denied = accessFailure(request);
  if (denied) return denied;
  const missing = ["OPENAI_API_KEY", "FIRECRAWL_API_KEY", "MONGODB_URI"].filter((key) => !process.env[key]);
  const visionFlag = (process.env.WEBFORGE_VISION_FALLBACK || "").trim().toLowerCase();
  const visionEnabled = !["0", "false", "off", "no"].includes(visionFlag);
  return NextResponse.json({ planner_ready: Boolean(process.env.OPENAI_API_KEY), extraction_ready: Boolean(process.env.FIRECRAWL_API_KEY), database_ready: Boolean(process.env.MONGODB_URI), vision_ready: Boolean(process.env.OPENAI_API_KEY) && visionEnabled, missing }, { headers: { "Cache-Control": "no-store" } });
}