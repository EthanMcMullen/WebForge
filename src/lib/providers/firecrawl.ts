import "server-only";
import { Firecrawl } from "firecrawl";
import type { ApiRecordData, ApiRecordSchema, SourceCandidate } from "../types";

import { extractionJsonSchema, normalizeCollectionData, normalizeExtractedData, verifiedProductProfile, verifyPriceEvidence } from "../extraction";
import { validatePriceSource } from "../record-quality";

export interface ExtractionProvider {
  discover(query: string, options: { excludedDomains: string[]; limit: number }): Promise<SourceCandidate[]>;
  extract(url: string, schema: ApiRecordSchema, subjectHint?: string, userRequest?: string, combineSources?: boolean): Promise<{ data: ApiRecordData; identity: string | null; sourceTitle?: string | null; canonicalUrl?: string | null; viaVision?: boolean }>;
  extractCollection?(url: string, schema: ApiRecordSchema, userRequest: string, subjectHint?: string): Promise<Array<{ data: ApiRecordData; identity: string | null; sourceTitle?: string | null; canonicalUrl?: string | null }>>;
}
function client(): Firecrawl {
  if (!process.env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is required to run an API job.");
  return new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY, timeoutMs: 12_000, maxRetries: 1 });
}
export const firecrawlProvider: ExtractionProvider = {
  async extractCollection(url, schema, userRequest, subjectHint) {
    const itemSchema = extractionJsonSchema(schema);
    const result = await client().scrape(url, { maxAge: 0, formats: [{
      type: "json",
      schema: { type: "object", properties: {
        items: { type: "array", items: itemSchema },
      }, required: ["items"], additionalProperties: false },
      prompt: [
        "Extract separate records for every distinct requested item actually listed on this page, up to 12. One array entry per item.",
        "For a course list, return a separate entry for each course code. For a single item page, return an array with one entry.",
        "Use only facts visible on this page. Do not invent members or fill absent fields. Do not combine facts from different items.",
        "Every entry must include its identifying name or code if the schema has such a field.",
        "User request: " + userRequest,
        subjectHint ? "Page hint: " + subjectHint : "",
      ].filter(Boolean).join(" "),
    }] });
    if (result.metadata?.statusCode && result.metadata.statusCode >= 400) {
      throw Object.assign(new Error('Source returned HTTP ' + result.metadata.statusCode + '.'), { status: result.metadata.statusCode });
    }
    if (result.metadata?.error) throw new Error(result.metadata.error);
    const rows = normalizeCollectionData(result.json, schema, url);
    return rows.map((data) => ({ data, identity: null, sourceTitle: result.metadata?.title || null,
      canonicalUrl: result.metadata?.sourceURL || null }));
  },
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
  async extract(url, schema, subjectHint, userRequest, combineSources) {
    if (userRequest) validatePriceSource(userRequest, schema, url);
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
      // A refresh must fetch the page again instead of reusing Firecrawl's indexed copy.
      maxAge: 0,
      formats: [
        ...(verifyPrice ? ["markdown" as const, "product" as const] : []),
        {
          type: "json",
          schema: identitySchema,
          prompt: [
            "Extract one record about the item requested by the user. Use only information present on this page.",
            combineSources ? "This page is one of several sources for the SAME item. Return null for fields absent here; another page may supply them. Identify the exact model and variant visible here." : "",
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
    const raw = result.json && typeof result.json === "object" && !Array.isArray(result.json) ? result.json : null;
    let data: ApiRecordData;
    try { data = normalizeExtractedData(raw, schema, url, Boolean(combineSources)); }
    catch (error) {
      const candidateIdentity = raw ? Object.fromEntries(
        ["product_name", "item_name", "name", "title"].filter((key) => typeof (raw as Record<string, unknown>)[key] === "string")
          .map((key) => [key, (raw as Record<string, unknown>)[key]])) as ApiRecordData : null;
      const product = verifyPrice ? verifiedProductProfile(result.product, url, candidateIdentity) : null;
      if (!product) throw error;
      const fallback: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(schema)) {
        if (key === "price") fallback[key] = product.price;
        else if (["product_name", "item_name", "name", "title"].includes(key) && field.type === "string") fallback[key] = product.title;
        else if (key === "currency" && field.type === "string") fallback[key] = product.currency;
        else if (key !== "source_url") fallback[key] = null;
      }
      data = normalizeExtractedData(fallback, schema, url, Boolean(combineSources));
    }
    const identity = result.json && typeof result.json === "object" &&
      typeof (result.json as Record<string, unknown>).__webforge_identity === "string"
      ? String((result.json as Record<string, unknown>).__webforge_identity).slice(0, 300) : null;
    if (verifyPrice) {
      const product = verifiedProductProfile(result.product, url, data);
      if (typeof data.price !== "number" && product) data.price = product.price;
      try { verifyPriceEvidence(data, result.markdown, subjectHint || result.metadata?.title); }
      catch (error) { if (!product || data.price !== product.price) throw error; }
    }
    if (Object.entries(data).every(([key, value]) => key === "source_url" || value === null)) {
      throw new Error("Firecrawl returned no usable fields.");
    }
    return { data, identity: identity || (typeof result.product?.title === "string" ? result.product.title : null), sourceTitle: result.metadata?.title || null,
      canonicalUrl: result.metadata?.sourceURL || null };
  },
};
