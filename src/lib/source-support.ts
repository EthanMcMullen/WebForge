import { normalizePublicUrl } from "./validation.ts";
import type { SourceCandidate, SourceFailureCode } from "./types.ts";

export const DEFAULT_BLOCKED_DOMAINS = ["instagram.com", "facebook.com"];
const LIST_PATH = /\/(search|search-results|category|categories|collections|tags?)\/?$/i;
const KNOWN_CATEGORY_PATH = /^\/c\/(?:kp|brand)\//i;
const MARKDOWN_LINK = /\[([^\]]{3,200})\]\((https?:\/\/[^\s)]+)\)/g;

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
  const add = (candidate: SourceCandidate) => {
    const url = normalizePublicUrl(candidate.url);
    if (!url || seen.has(url)) return;
    const host = domainOf(url);
    if (!host || isBlockedDomain(host, blocked)) return;
    const path = new URL(url).pathname;
    if (LIST_PATH.test(path) || KNOWN_CATEGORY_PATH.test(path)) return;
    seen.add(url);
    added.push({ url, title: candidate.title?.slice(0, 200), description: candidate.description?.slice(0, 300), parentUrl: candidate.parentUrl });
  };
  for (const result of results) {
    if (added.length >= max) break;
    add(result);
    const parentUrl = normalizePublicUrl(result.url);
    const parentPath = parentUrl ? new URL(parentUrl).pathname : "";
    if (added.length >= max || !result.description ||
        !(LIST_PATH.test(parentPath) || KNOWN_CATEGORY_PATH.test(parentPath))) continue;
    const parentHost = domainOf(parentUrl || "");
    for (const match of result.description.matchAll(MARKDOWN_LINK)) {
      if (added.length >= max) break;
      // Search snippets may contain product links inside a category result.
      // Follow only links on that same domain; source review still checks relevance.
      if (parentHost && domainOf(match[2]) === parentHost) {
        add({ url: match[2], title: match[1], description: result.title, parentUrl: parentUrl || undefined });
      }
    }
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
  if (/price was not supported by source text/.test(message)) return "UNVERIFIED_PRICE";
  if (/invalid value for/.test(message)) return "SCHEMA_MISMATCH";
  if (status === 404 || (status !== undefined && status >= 500) || /source returned http/.test(message)) return "SOURCE_HTTP_ERROR";
  return "TRANSIENT";
}
export function isFatalFailure(code: SourceFailureCode): boolean {
  return code === "RATE_LIMITED" || code === "CONFIG_OR_BILLING";
}
