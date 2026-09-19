import { createHmac, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE = "webforge_access";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export function accessSecret(): string | null {
  return process.env.WEBFORGE_ACCESS_TOKEN?.trim() || null;
}

export function accessRequired(secret = accessSecret(), production = process.env.NODE_ENV === "production"): boolean {
  return Boolean(secret) || production;
}

function equalSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validAccessToken(value: string, secret = accessSecret()): boolean {
  return Boolean(secret && equalSecret(value, secret));
}

export function createAccessSession(secret: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + SESSION_SECONDS;
  const signature = createHmac("sha256", secret).update(`webforge:${expires}`).digest("hex");
  return `${expires}.${signature}`;
}

export function validAccessSession(value: string | undefined, secret: string, now = Date.now()): boolean {
  if (!value) return false;
  const [expiryText, signature, extra] = value.split(".");
  const expiry = Number(expiryText);
  if (extra || !/^\d{10}$/.test(expiryText) || !/^[a-f0-9]{64}$/.test(signature || "") ||
      expiry <= Math.floor(now / 1000) || expiry > Math.floor(now / 1000) + SESSION_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`webforge:${expiry}`).digest("hex");
  return equalSecret(signature, expected);
}

function cookieValue(request: Request): string | undefined {
  const pair = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${ACCESS_COOKIE}=`));
  return pair?.slice(ACCESS_COOKIE.length + 1);
}

export function isAuthorized(request: Request, secret = accessSecret(), production = process.env.NODE_ENV === "production"): boolean {
  if (!accessRequired(secret, production)) return true;
  if (!secret) return false;
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ") && validAccessToken(authorization.slice(7), secret)) return true;
  if (!validAccessSession(cookieValue(request), secret)) return false;
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return false;
  }
  return true;
}

export function accessFailure(request: Request): Response | null {
  const secret = accessSecret();
  if (isAuthorized(request, secret)) return null;
  return Response.json({ error: secret ? "Unlock WebForge to access this API." : "Set WEBFORGE_ACCESS_TOKEN before serving WebForge." },
    { status: secret ? 401 : 503, headers: { "Cache-Control": "no-store" } });
}
