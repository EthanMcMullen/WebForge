import { cleanSourceUrls } from "./validation.ts";
import type { ApiRecordData, ApiRecordSchema } from "./types";

export function extractionJsonSchema(schema: ApiRecordSchema): Record<string, unknown> {
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

export function normalizeExtractedData(raw: unknown, schema: ApiRecordSchema, sourceUrl: string): ApiRecordData {
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
  if (Object.values(data).every((value) => value === null)) {
    throw new Error("Firecrawl returned no usable fields.");
  }
  data.source_url = sourceUrl;
  return data;
}

export function selectSourceUrls(results: Array<{ url?: string; metadata?: { sourceURL?: string; url?: string } }>, limit = 5): string[] {
  const candidates = results.map((item) => item.url || item.metadata?.sourceURL || item.metadata?.url).filter((url): url is string => Boolean(url));
  return cleanSourceUrls(candidates).slice(0, limit);
}
