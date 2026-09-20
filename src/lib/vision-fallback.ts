import { classifySourceError } from "./source-support.ts";
import { verifyPriceEvidence } from "./extraction.ts";
import type { ApiRecordData } from "./types.ts";
import type { SourceFailureCode } from "./types.ts";

/**
 * Vision fallback policy.
 *
 * When text scraping cannot produce a record (empty markdown, no structured
 * JSON, malformed values), the page may still render fine in a browser. In
 * that case the pipeline screenshots the page and asks a vision-capable LLM
 * to read the same fields off the screenshot. The vision result passes
 * through every downstream gate (price evidence, record review, quality
 * checks) exactly like a scraped record.
 */

// Extraction-content failures where a different modality may succeed, plus
// access blocks: the page exists, and a stealth-proxied rendered screenshot
// can succeed where text extraction was denied (e.g. retailer bot walls).
const VISION_ELIGIBLE: ReadonlySet<SourceFailureCode> = new Set([
  "NO_STRUCTURED_JSON",
  "SCHEMA_MISMATCH",
  "TRANSIENT",
  "ACCESS_BLOCKED",
]);

export function isVisionFallbackEligible(error: unknown): boolean {
  return VISION_ELIGIBLE.has(classifySourceError(error));
}

export function visionFallbackEnabled(): boolean {
  if (!process.env.OPENAI_API_KEY) return false;
  const flag = (process.env.WEBFORGE_VISION_FALLBACK || "").trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "off" && flag !== "no";
}

export function visionModel(): string {
  return process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

/** Require the exact extracted item and amount to appear together in page text or a short visual transcription. */
export function verifyVisionPriceEvidence(
  data: ApiRecordData, markdown?: string, visualEvidence?: string | null, subjectHint?: string,
): void {
  try { verifyPriceEvidence(data, markdown, subjectHint); }
  catch {
    if (!visualEvidence || visualEvidence.length > 500) throw new Error("Vision fallback price was not supported by source text.");
    try { verifyPriceEvidence(data, visualEvidence, subjectHint); }
    catch { throw new Error("Vision fallback price was not supported by source text."); }
  }
}
