import "server-only";
import { Firecrawl } from "firecrawl";
import type { ApiRecordData, ApiRecordSchema, SourceCandidate } from "../types";

import { extractionJsonSchema, normalizeExtractedData, verifyPriceEvidence } from "../extraction";

export interface ExtractionProvider {
  discover(query: string, options: { excludedDomains: string[]; limit: number }): Promise<SourceCandidate[]>;
  extract(url: string, schema: ApiRecordSchema, subjectHint?: string, userRequest?: string): Promise<{ data: ApiRecordData; identity: string | null }>;
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
  async extract(url, schema, subjectHint, userRequest) {
    const verifyPrice = schema.price?.type === "number" || schema.price?.type === "integer";
    const extractionSchema = extractionJsonSchema(schema);
    const identitySchema = {
      ...extractionSchema,
      properties: {
        ...extractionSchema.properties,
        __webforge_identity: { type: ["string", "null"] as ["string", "null"], description: "Exact entity or product name and named retailer visible on this page; null if unclear" },
      },
      required: [...extractionSchema.required, "__webforge_identity"],
    };
    const result = await client().scrape(url, {
      formats: [
        ...(verifyPrice ? ["markdown" as const] : []),
        {
          type: "json",
          schema: identitySchema,
          prompt: [
            "Extract one record about the item requested by the user. Use only information present on this page.",
            "On a category page, use only the matching product card, never a related item or recommendation.",
            "The price must belong to that same item. Return null for unavailable fields; do not infer values.",
            userRequest ? `User request: ${userRequest}` : "",
            subjectHint ? `Matching item hint: ${subjectHint}` : "",
          ].filter(Boolean).join(" "),
        },
      ],
    });
    if (result.metadata?.statusCode && result.metadata.statusCode >= 400) {
      throw Object.assign(new Error(`Source returned HTTP ${result.metadata.statusCode}.`), { status: result.metadata.statusCode });
    }
    if (result.metadata?.error) throw new Error(result.metadata.error);
    const data = normalizeExtractedData(result.json, schema, url);
    const identity = result.json && typeof result.json === "object" &&
      typeof (result.json as Record<string, unknown>).__webforge_identity === "string"
      ? String((result.json as Record<string, unknown>).__webforge_identity).slice(0, 300) : null;
    if (verifyPrice) verifyPriceEvidence(data, result.markdown, subjectHint || result.metadata?.title);
    if (Object.entries(data).every(([key, value]) => key === "source_url" || value === null)) {
      throw new Error("Firecrawl returned no usable fields.");
    }
    return { data, identity };
  },
};
