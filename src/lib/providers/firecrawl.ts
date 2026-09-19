import "server-only";
import { Firecrawl } from "firecrawl";
import type { ApiRecordData, ApiRecordSchema } from "../types";

import { extractionJsonSchema, normalizeExtractedData, selectSourceUrls } from "../extraction";

export interface ExtractionProvider {
  discover(searchQueries: string[]): Promise<string[]>;
  extract(url: string, schema: ApiRecordSchema): Promise<ApiRecordData>;
}

function client(): Firecrawl {
  if (!process.env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is required to run an API job.");
  return new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });
}

export const firecrawlProvider: ExtractionProvider = {
  async discover(searchQueries) {
    const firecrawl = client();
    const resultsFound: Array<{ url?: string; metadata?: { sourceURL?: string; url?: string } }> = [];
    for (const query of searchQueries.slice(0, 3)) {
      const results = await firecrawl.search(query, { limit: 5, sources: ["web"] });
      resultsFound.push(...(results.web || []));
      if (selectSourceUrls(resultsFound).length >= 5) break;
    }
    return selectSourceUrls(resultsFound);
  },
  async extract(url, schema) {
    const firecrawl = client();
    const result = await firecrawl.scrape(url, {
      formats: [{
        type: "json",
        schema: extractionJsonSchema(schema),
        prompt: "Extract one record about the primary item or subject on this page. Use only information present on the page. Return null for unavailable fields. Do not infer values.",
      }],
    });
    if (result.metadata?.statusCode && result.metadata.statusCode >= 400) {
      throw new Error(`Source returned HTTP ${result.metadata.statusCode}.`);
    }
    if (result.metadata?.error) throw new Error(result.metadata.error);
    return normalizeExtractedData(result.json, schema, url);
  },
};