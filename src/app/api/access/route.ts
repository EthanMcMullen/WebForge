import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, accessRequired, accessSecret, createAccessSession, isAuthorized, validAccessToken } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const secret = accessSecret();
  return NextResponse.json({ required: accessRequired(secret), configured: Boolean(secret), authenticated: isAuthorized(request, secret) },
    { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const secret = accessSecret();
  if (!secret) return NextResponse.json({ error: "Set WEBFORGE_ACCESS_TOKEN on the server first." }, { status: 503 });
  let token: unknown;
  try { token = (await request.json() as { token?: unknown }).token; }
  catch { return NextResponse.json({ error: "Enter an access token." }, { status: 400 }); }
  if (typeof token !== "string" || token.length > 2048 || !validAccessToken(token, secret)) {
    return NextResponse.json({ error: "Access token is incorrect." }, { status: 401 });
  }
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(ACCESS_COOKIE, createAccessSession(secret), {
    httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "strict", path: "/", maxAge: 7 * 24 * 60 * 60,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ACCESS_COOKIE, "", { path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
