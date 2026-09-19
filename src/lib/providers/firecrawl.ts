import "server-only";
import { Firecrawl } from "firecrawl";
import type { ApiRecordData, ApiRecordSchema, SourceCandidate } from "../types";

import { extractionJsonSchema, normalizeExtractedData } from "../extraction";

export interface ExtractionProvider {
  discover(query: string, options: { excludedDomains: string[]; limit: number }): Promise<SourceCandidate[]>;
  extract(url: string, schema: ApiRecordSchema): Promise<ApiRecordData>;
}
function client(): Firecrawl {
  if (!process.env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is required to run an API job.");
  return new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY, timeoutMs: 12_000, maxRetries: 1 });
}
export const firecrawlProvider: ExtractionProvider = {
  async discover(query, options) {
    const results = await client().search(query, {
      limit: Math.min(options.limit, 5),
      sources: ["web"],
      ...(options.excludedDomains.length ? { excludeDomains: options.excludedDomains } : {}),
    });
    return (results.web || []).map((item) => {
      const result = item as { url?: string; metadata?: { sourceURL?: string; url?: string }; title?: string; description?: string };
      return {
        url: result.url || result.metadata?.sourceURL || result.metadata?.url || "",
        title: result.title,
        description: result.description,
      };
    }).filter((item) => Boolean(item.url));
  },
  async extract(url, schema) {
    const result = await client().scrape(url, {
      formats: [{
        type: "json",
        schema: extractionJsonSchema(schema),
        prompt: "Extract one record about the primary item or subject on this page. Use only information present on the page. Return null for unavailable fields. Do not infer values.",
      }],
    });
    if (result.metadata?.statusCode && result.metadata.statusCode >= 400) {
      throw Object.assign(new Error(`Source returned HTTP ${result.metadata.statusCode}.`), { status: result.metadata.statusCode });
    }
    if (result.metadata?.error) throw new Error(result.metadata.error);
    const data = normalizeExtractedData(result.json, schema, url);
    if (Object.entries(data).every(([key, value]) => key === "source_url" || value === null)) {
      throw new Error("Firecrawl returned no usable fields.");
    }
    return data;
  },
};
