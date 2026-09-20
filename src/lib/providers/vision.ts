import "server-only";
import { Firecrawl } from "firecrawl";
import OpenAI from "openai";
import type { ApiRecordData, ApiRecordSchema } from "../types";
import { extractionJsonSchema, normalizeExtractedData, verifyPriceEvidence } from "../extraction";
import { isFatalFailure } from "../source-support";
import { classifySourceError } from "../source-support";
import { isVisionFallbackEligible, visionFallbackEnabled, visionModel } from "../vision-fallback";
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
    },
    required: [...extractionSchema.required, "__webforge_identity"],
  };
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = [
    "Read one record about the item requested by the user from this page screenshot. Use only information visible in the screenshot.",
    options.combineSources ? "This page is one of several sources for the SAME item. Return null for fields not visible here; another page may supply them." : "",
    "The price must belong to that same item. Return null for unavailable fields; do not infer values.",
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
    try {
      verifyPriceEvidence(data, capture.markdown, options.subjectHint);
    } catch {
      throw new Error("Vision fallback price was not supported by source text.");
    }
  }
  return { data, identity };
}

export interface VisionFallbackDeps {
  /** Per-run budget gate. Return true to spend one vision attempt. */
  requestAttempt?: () => boolean;
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
      try {
        return await base.extract(url, schema, subjectHint, userRequest, combineSources);
      } catch (error) {
        if (!isVisionFallbackEligible(error) || !visionFallbackEnabled()) throw error;
        if (deps.requestAttempt && !deps.requestAttempt()) throw error;
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
        if (Object.entries(data).every(([key, value]) => key === "source_url" || value === null)) {
          throw error;
        }
        return { data, identity: raw.identity, viaVision: true as const };
      }
    },
  };
}
