import { cleanSourceUrls } from "./validation.ts";
import type { ApiRecordData, ApiRecordSchema } from "./types";

export function extractionJsonSchema(schema: ApiRecordSchema): {
  type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false;
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(schema)) {
    if (key === "source_url") continue;
    properties[key] = {
      type: [field.type === "integer" ? "integer" : field.type, "null"],
      description: field.description || `Value for ${key}; use null if unavailable`,
    };
    required.push(key);
  }
  if (!required.length) throw new Error("The job schema has no extractable fields.");
  return { type: "object", properties, required, additionalProperties: false };
}

export function normalizeExtractedData(raw: unknown, schema: ApiRecordSchema, sourceUrl: string, allowSparse = false): ApiRecordData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Firecrawl returned no structured JSON object.");
  }
  const input = raw as Record<string, unknown>;
  const data: ApiRecordData = {};
  for (const [key, field] of Object.entries(schema)) {
    if (key === "source_url") continue;
    const value = input[key];
    if (value === undefined || value === null) { data[key] = null; continue; }
    const valid = field.type === "string" ? typeof value === "string"
      : field.type === "boolean" ? typeof value === "boolean"
      : field.type === "integer" ? typeof value === "number" && Number.isSafeInteger(value)
      : typeof value === "number" && Number.isFinite(value);
    if (!valid) throw new Error(`Firecrawl returned an invalid value for ${key}.`);
    data[key] = value as string | number | boolean;
  }
  const filled = Object.values(data).filter((value) => value !== null && value !== "").length;
  const total = Object.keys(data).length;
  if (filled === 0) throw new Error("Firecrawl returned no usable fields.");
  if (!allowSparse && total >= 4 && filled < Math.ceil(total / 2)) {
    throw new Error(`Firecrawl returned an incomplete record (${filled}/${total} fields).`);
  }
  data.source_url = sourceUrl;
  return data;
}

/**
 * Check that a numeric price appears next to the extracted item's name in
 * Firecrawl's page text. This prevents a recommendation card's price from
 * becoming the price of the main product.
 */
export function verifyPriceEvidence(
  data: ApiRecordData,
  markdown: string | undefined,
  subjectHint?: string,
): void {
  if (typeof data.price !== "number") return;
  const name = typeof data.product_name === "string" && data.product_name.trim()
    ? data.product_name.trim()
    : subjectHint?.replace(/[,\s]*[$€£].*$/u, "").replace(/\*+/g, "").trim();
  if (!name || !markdown) throw new Error("Price was not supported by source text.");
  const haystack = markdown.toLowerCase();
  const needle = name.toLowerCase();
  const amount = data.price.toFixed(2);
  const pricePattern = new RegExp("[\\$€£]\\s*" + amount.replace(".", "\\.") + "(?!\\d)", "u");
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) !== -1) {
    const nearby = markdown.slice(Math.max(0, offset - 100), offset + name.length + 350);
    if (pricePattern.test(nearby)) return;
    offset += needle.length;
  }
  throw new Error("Price was not supported by source text.");
}

export function selectSourceUrls(results: Array<{ url?: string; metadata?: { sourceURL?: string; url?: string } }>, limit = 5): string[] {
  const candidates = results.map((item) => item.url || item.metadata?.sourceURL || item.metadata?.url).filter((url): url is string => Boolean(url));
  return cleanSourceUrls(candidates).slice(0, limit);
}
