import { normalizePublicUrl } from "./validation.ts";
import type { SourceCandidate, SourceFailureCode } from "./types.ts";

export const DEFAULT_BLOCKED_DOMAINS = ["instagram.com", "facebook.com"];
const LIST_PATH = /\/(search|search-results|category|categories|collections|tags?)\/?$/i;

export function domainOf(value: string): string | null {
  try { return new URL(value).hostname.toLowerCase().replace(/\.$/, ""); }
  catch { return null; }
}
export function isBlockedDomain(host: string, blocked: string[]): boolean {
  return blocked.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
export function filterCandidates(
  results: SourceCandidate[], blocked: string[], seen: Set<string>, max: number,
): SourceCandidate[] {
  const added: SourceCandidate[] = [];
  if (max <= 0) return added;
  for (const result of results) {
    const url = normalizePublicUrl(result.url);
    if (!url || seen.has(url)) continue;
    const host = domainOf(url);
    if (!host || isBlockedDomain(host, blocked) || LIST_PATH.test(new URL(url).pathname)) continue;
    seen.add(url);
    added.push({ url, title: result.title?.slice(0, 200), description: result.description?.slice(0, 300) });
    if (added.length >= max) break;
  }
  return added;
}
export function classifySourceError(error: unknown): SourceFailureCode {
  const candidate = error as { status?: number; statusCode?: number; code?: string; message?: string };
  const status = candidate?.status ?? candidate?.statusCode;
  const message = String(candidate?.message || "").toLowerCase();
  if (message.startsWith("source returned http")) {
    return status === 401 || status === 403 ? "ACCESS_BLOCKED" : "SOURCE_HTTP_ERROR";
  }
  if (status === 429 || /rate.limit|quota|credit.*exhaust|insufficient.credit/.test(message)) return "RATE_LIMITED";
  if (status === 401 || status === 402 || /invalid.api.key|billing|payment.required|unauthorized/.test(message)) return "CONFIG_OR_BILLING";
  if (/do not support this site|unsupported.site|site.not.supported/.test(message)) return "UNSUPPORTED_SITE";
  if (status === 403 || /login.required|access.denied|captcha|blocked.by/.test(message)) return "ACCESS_BLOCKED";
  if (/no structured json|no usable fields/.test(message)) return "NO_STRUCTURED_JSON";
  if (/invalid value for/.test(message)) return "SCHEMA_MISMATCH";
  if (status === 404 || (status !== undefined && status >= 500) || /source returned http/.test(message)) return "SOURCE_HTTP_ERROR";
  return "TRANSIENT";
}
export function isFatalFailure(code: SourceFailureCode): boolean {
  return code === "RATE_LIMITED" || code === "CONFIG_OR_BILLING";
}
