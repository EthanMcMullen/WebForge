import { normalizePublicUrl } from "./validation.ts";
import { isAmazonHost, isAmazonProductPage } from "./record-quality.ts";
import type { SourceCandidate, SourceFailureCode } from "./types.ts";

export const DEFAULT_BLOCKED_DOMAINS = ["instagram.com", "facebook.com"];
const LIST_PATH = /\/(?:search|search-results|category|categories|collections|tags?)(?:\/|$)/i;
const KNOWN_CATEGORY_PATH = /^\/c\/(?:kp|brand)\//i;
const AMAZON_LIST_PATH = /^\/(?:s|clp|gp\/browse|b)(?:\/|$)/i;
const AMAZON_ASIN_LANDING_PATH = /^\/clp\/(B[A-Z0-9]{9}|[0-9]{10})\/?$/i;
const MARKDOWN_LINK = /\[([^\]]{3,200})\]\((https?:\/\/[^\s)]+)\)/g;

export function domainOf(value: string): string | null {
  try { return new URL(value).hostname.toLowerCase().replace(/\.$/, ""); }
  catch { return null; }
}
export function isBlockedDomain(host: string, blocked: string[]): boolean {
  return blocked.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
export function filterCandidates(
  results: SourceCandidate[], blocked: string[], seen: Set<string>, max: number, allowLists = false,
  priceRequested = false,
): SourceCandidate[] {
  const added: SourceCandidate[] = [];
  if (max <= 0) return added;
  const add = (candidate: SourceCandidate) => {
    let url = normalizePublicUrl(candidate.url);
    if (!url || seen.has(url)) return;
    const host = domainOf(url);
    if (!host || isBlockedDomain(host, blocked)) return;
    let parentUrl = candidate.parentUrl;
    let path = new URL(url).pathname;
    // Search providers sometimes label a specific product with an Amazon
    // landing URL. Its existing ASIN identifies the corresponding detail URL;
    // source review and the usual ASIN/price checks still validate the result.
    const asin = priceRequested && isAmazonHost(host) ? path.match(AMAZON_ASIN_LANDING_PATH)?.[1] : null;
    if (asin) {
      parentUrl = url;
      const detail = new URL(url);
      detail.pathname = `/dp/${asin.toUpperCase()}`;
      detail.search = "";
      url = detail.toString();
      path = detail.pathname;
    }
    if (seen.has(url)) return;
    const knownListing = LIST_PATH.test(path) || KNOWN_CATEGORY_PATH.test(path) ||
      (isAmazonHost(host) && AMAZON_LIST_PATH.test(path));
    if ((priceRequested || !allowLists) && knownListing) return;
    if (priceRequested && isAmazonHost(host) && !isAmazonProductPage(url)) return;
    seen.add(url);
    added.push({ url, title: candidate.title?.slice(0, 200), description: candidate.description?.slice(0, 300), parentUrl });
  };
  for (const result of results) {
    if (added.length >= max) break;
    add(result);
    const parentUrl = normalizePublicUrl(result.url);
    const parentPath = parentUrl ? new URL(parentUrl).pathname : "";
    const parentHost = domainOf(parentUrl || "");
    if (added.length >= max || !result.description ||
        !(LIST_PATH.test(parentPath) || KNOWN_CATEGORY_PATH.test(parentPath) ||
          (parentHost && isAmazonHost(parentHost) && AMAZON_LIST_PATH.test(parentPath)))) continue;
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
  if (status === 401 || status === 402 || /invalid.api.key|api.key is required|billing|payment.required|unauthorized/.test(message)) return "CONFIG_OR_BILLING";
  if (/do not support this site|unsupported.site|site.not.supported/.test(message)) return "UNSUPPORTED_SITE";
  if (status === 403 || /login.required|access.denied|captcha|blocked.by/.test(message)) return "ACCESS_BLOCKED";
  if (/no structured json|no usable fields|no new fields for the combined record|collection item has no identifying field/.test(message)) return "NO_STRUCTURED_JSON";
  if (/vision fallback.*(no usable fields|no data|no page screenshot)/.test(message)) return "NO_STRUCTURED_JSON";
  if (/price was not supported by source text/.test(message)) return "UNVERIFIED_PRICE";
  if (/vision fallback price was not supported/.test(message)) return "UNVERIFIED_PRICE";
  if (/required price is missing|amazon price needs a product detail page/.test(message)) return "MISSING_REQUIRED_FIELD";
  if (/amazon product (?:asin|variant) does not match|source identity conflicts/.test(message)) return "SOURCE_IDENTITY_MISMATCH";
  if (/record does not match the request/.test(message)) return "IRRELEVANT_RECORD";
  if (/invalid value for|incomplete record/.test(message)) return "SCHEMA_MISMATCH";
  if (/vision fallback.*(invalid value|incomplete record)/.test(message)) return "SCHEMA_MISMATCH";
  if (status === 404 || (status !== undefined && status >= 500) || /source returned http/.test(message)) return "SOURCE_HTTP_ERROR";
  return "TRANSIENT";
}
export function isFatalFailure(code: SourceFailureCode): boolean {
  return code === "RATE_LIMITED" || code === "CONFIG_OR_BILLING";
}
