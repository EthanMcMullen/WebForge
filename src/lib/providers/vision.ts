import "server-only";
import { Firecrawl } from "firecrawl";
import OpenAI from "openai";
import type { ApiRecordData, ApiRecordSchema } from "../types";
import { extractionJsonSchema, normalizeExtractedData } from "../extraction";
import { isAmazonHost, isAmazonProductPage } from "../record-quality";
import { isFatalFailure } from "../source-support";
import { classifySourceError } from "../source-support";
import { isVisionFallbackEligible, verifyVisionPriceEvidence, visionFallbackEnabled, visionModel } from "../vision-fallback";
import type { ExtractionProvider } from "./firecrawl";

export interface VisionCapture {
  screenshotUrl: string;
  markdown?: string;
}

export interface VisionExtractOptions {
  sourceUrl: string;
  userRequest?: string;
  subjectHint?: string;
  combineSources?: boolean;
}

async function defaultCapture(url: string): Promise<VisionCapture> {
  if (!process.env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY is required to run an API job.");
  const client = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY, timeoutMs: 12_000, maxRetries: 1 });
  const result = await client.scrape(url, {
    maxAge: 0,
    // Stealth proxy only on this bounded fallback path: bot-walled pages
    // (e.g. Amazon) may render for screenshots where text extraction was denied.
    proxy: "stealth",
    formats: [{ type: "screenshot", fullPage: true }, "markdown"],
  });
  const screenshotUrl = typeof result.screenshot === "string" ? result.screenshot : "";
  if (!screenshotUrl) throw new Error("Vision fallback found no page screenshot.");
  return { screenshotUrl, markdown: result.markdown };
}

async function defaultReadImage(
  capture: VisionCapture, schema: ApiRecordSchema, options: VisionExtractOptions,
): Promise<{ data: ApiRecordData; identity: string | null }> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for vision fallback.");
  const extractionSchema = extractionJsonSchema(schema);
  const identitySchema = {
    ...extractionSchema,
    properties: {
      ...extractionSchema.properties,
      __webforge_identity: { type: ["string", "null"] as ["string", "null"], description: "Exact entity or product name and named retailer visible in this screenshot; null if unclear" },
      __webforge_price_evidence: { type: ["string", "null"] as ["string", "null"], description: "Short exact visible phrase containing this item's name and its current price together; null if not visible" },
    },
    required: [...extractionSchema.required, "__webforge_identity", "__webforge_price_evidence"],
  };
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = [
    "Read one record about the item requested by the user from this page screenshot. Use only information visible in the screenshot.",
    options.combineSources ? "This page is one of several sources for the SAME item. Return null for fields not visible here; another page may supply them." : "",
    "The price must belong to that same item. Return null for unavailable fields; do not infer values.",
    "If a current price is visible next to the requested item's name, transcribe that short phrase exactly into __webforge_price_evidence. Do not use prices from recommendations, search results, crossed-out list prices, or another variant. Otherwise return null for the price and its evidence.",
    options.userRequest ? `User request: ${options.userRequest}` : "",
    options.subjectHint ? `Matching item hint: ${options.subjectHint}` : "",
  ].filter(Boolean).join(" ");
  const response = await client.responses.create({
    model: visionModel(),
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        { type: "input_image", image_url: capture.screenshotUrl, detail: "high" },
      ],
    }],
    text: { format: { type: "json_schema", name: "vision_record", strict: true, schema: identitySchema } },
  });
  if (!response.output_text) throw new Error("Vision fallback returned no data.");
  let raw: unknown;
  try {
    raw = JSON.parse(response.output_text);
  } catch {
    throw new Error("Vision fallback returned no usable fields.");
  }
  let data: ApiRecordData;
  try {
    data = normalizeExtractedData(raw, schema, options.sourceUrl, Boolean(options.combineSources));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vision fallback returned no usable fields.";
    throw new Error(message.replace("Firecrawl", "Vision fallback"));
  }
  const identity = raw && typeof raw === "object" &&
    typeof (raw as Record<string, unknown>).__webforge_identity === "string"
    ? String((raw as Record<string, unknown>).__webforge_identity).slice(0, 300) : null;
  if (schema.price?.type === "number" || schema.price?.type === "integer") {
    if (!options.combineSources && typeof data.price !== "number") throw new Error("Vision fallback required price is missing.");
    if (typeof data.price === "number") verifyVisionPriceEvidence(data, capture.markdown,
      typeof (raw as Record<string, unknown>).__webforge_price_evidence === "string"
        ? (raw as Record<string, string>).__webforge_price_evidence : null, options.subjectHint);
  }
  return { data, identity };
}

export interface VisionFallbackDeps {
  /** Per-run budget gate. Return true to spend one vision attempt. */
  requestAttempt?: () => boolean | Promise<boolean>;
  capture?: (url: string) => Promise<VisionCapture>;
  readImage?: (capture: VisionCapture, schema: ApiRecordSchema, options: VisionExtractOptions) => Promise<{ data: ApiRecordData; identity: string | null }>;
}

/**
 * Decorate a text-scraping provider with a vision fallback. When the base
 * extract fails with an extraction-content error and the per-run budget
 * allows it, the page is screenshotted and read by a vision LLM. Results
 * carry `viaVision: true` so the pipeline can account the extra scrape.
 */
export function withVisionFallback(base: ExtractionProvider, deps: VisionFallbackDeps = {}): ExtractionProvider {
  const capture = deps.capture || defaultCapture;
  const readImage = deps.readImage || defaultReadImage;
  return {
    discover: (query, options) => base.discover(query, options),
    async extract(url, schema, subjectHint, userRequest, combineSources) {
      const numericPrice = schema.price?.type === "number" || schema.price?.type === "integer";
      try {
        const extracted = await base.extract(url, schema, subjectHint, userRequest, combineSources);
        if (numericPrice && !combineSources && typeof extracted.data.price !== "number") {
          throw new Error("Required price is missing from the record.");
        }
        return extracted;
      } catch (error) {
        // A screenshot cannot turn an Amazon search/category page into a product price source.
        if (numericPrice && isAmazonHost(new URL(url).hostname.toLowerCase()) && !isAmazonProductPage(url)) throw error;
        const code = classifySourceError(error);
        if (!(isVisionFallbackEligible(error) || (numericPrice &&
            (code === "MISSING_REQUIRED_FIELD" || code === "UNVERIFIED_PRICE"))) || !visionFallbackEnabled()) throw error;
        if (deps.requestAttempt && !await deps.requestAttempt()) throw error;
        let raw: { data: ApiRecordData; identity: string | null };
        try {
          const shot = await capture(url);
          raw = await readImage(shot, schema, { sourceUrl: url, userRequest, subjectHint, combineSources });
        } catch (visionError) {
          // A fatal vision failure (bad key, billing, rate limit) stops the run.
          if (isFatalFailure(classifySourceError(visionError))) throw visionError;
          throw error;
        }
        const data: ApiRecordData = { ...raw.data, source_url: url };
        if (numericPrice && !combineSources && typeof data.price !== "number") throw error;
        if (Object.entries(data).every(([key, value]) => key === "source_url" || value === null)) {
          throw error;
        }
        return { data, identity: raw.identity, viaVision: true as const };
      }
    },
  };
}
