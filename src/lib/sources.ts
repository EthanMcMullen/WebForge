import "server-only";

import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import OpenAI from "openai";
import { cleanSourceUrls, normalizePublicUrl } from "./validation";
import type { FieldDefinition, Plan, ProposedField, ProposedRecord } from "./types";

const SearchSchema = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string() })).max(8),
});

const ExtractSchema = z.object({
  fields: z.array(z.object({
    key: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
    quote: z.string(),
    kind: z.enum(["text", "image"]),
    imageUrl: z.string().nullable(),
  })).max(20),
});

const VisionSchema = {
  type: "object",
  properties: {
    observed: { type: "boolean" },
    value: { type: ["string", "number", "boolean", "null"] },
    description: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["observed", "value", "description", "confidence"],
  additionalProperties: false,
} as const;

function requireSourceKeys(): void {
  if (!process.env.BROWSERBASE_API_KEY || !process.env.OPENAI_API_KEY) {
    throw new Error("BROWSERBASE_API_KEY and OPENAI_API_KEY are required for live mode.");
  }
}

function makeStagehand(): Stagehand {
  requireSourceKeys();
  return new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY,
    model: process.env.STAGEHAND_MODEL || "openai/gpt-4.1-mini",
    verbose: 0,
  });
}

function requirePage(stagehand: Stagehand) {
  const page = stagehand.context.activePage();
  if (!page) throw new Error("Browserbase did not open a page.");
  return page;
}

function resolveImageUrl(value: string | null, sourceUrl: string): string | null {
  if (!value) return null;
  try { return normalizePublicUrl(new URL(value, sourceUrl).toString()); }
  catch { return null; }
}

export async function discoverSources(plan: Plan): Promise<string[]> {
  const stagehand = makeStagehand();
  const links: string[] = [];
  try {
    await stagehand.init();
    const page = requirePage(stagehand);
    for (const query of plan.searchQueries.slice(0, 2)) {
      await page.goto(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
      const result = await stagehand.extract("Find up to 5 organic result links to public pages that directly contain the requested data. Skip ads, search pages, login pages and category-only pages.", SearchSchema);
      links.push(...result.results.map((item) => item.url));
      if (cleanSourceUrls(links).length >= 5) break;
    }
  } finally {
    await stagehand.close();
  }
  return cleanSourceUrls(links).filter((url) => !new URL(url).hostname.includes("duckduckgo.com")).slice(0, 5);
}

async function inspectImage(imageUrl: string, field: FieldDefinition): Promise<ProposedField | null> {
  const safeUrl = normalizePublicUrl(imageUrl);
  if (!safeUrl || !process.env.OPENAI_API_KEY) return null;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [{ role: "user", content: [
      { type: "input_text", text: `Inspect this product image for ${field.label}. Report only what is directly visible. If unclear, set observed=false and value=null. For ports, do not infer USB-C from branding or specifications outside this image.` },
      { type: "input_image", image_url: safeUrl, detail: "auto" },
    ] }],
    text: { format: { type: "json_schema", name: "visual_observation", strict: true, schema: VisionSchema } },
  });
  if (!response.output_text) return null;
  const observed = JSON.parse(response.output_text) as { observed: boolean; value: ProposedField["value"]; description: string; confidence: number };
  if (!observed.observed || observed.value === null || observed.confidence < 0.8) return null;
  return { key: field.key, value: observed.value, quote: observed.description, imageUrl: safeUrl, kind: "image", confidence: Math.min(1, Math.max(0, observed.confidence)) };
}

export async function extractSources(sourceUrls: string[], fields: FieldDefinition[]): Promise<{ records: ProposedRecord[]; errors: string[] }> {
  const stagehand = makeStagehand();
  const records: ProposedRecord[] = [];
  const errors: string[] = [];
  try {
    await stagehand.init();
    const page = requirePage(stagehand);
    for (const sourceUrl of sourceUrls.slice(0, 10)) {
      try {
        await page.goto(sourceUrl);
        const requested = fields.map((field) => `${field.key} (${field.type})`).join(", ");
        const result = await stagehand.extract(
          `Extract one product or entity from this page. Requested fields: ${requested}. For each field return the exact visible text that supports the value in quote and kind=text. If the claim is based on visual appearance, use kind=image and a short visual description. Return null when missing. Include an absolute product image URL if available. Do not invent facts.`,
          ExtractSchema,
        );
        const proposals: ProposedField[] = result.fields
          .filter((item) => fields.some((field) => field.key === item.key))
          .map((item) => ({ key: item.key, value: item.value, quote: item.quote, imageUrl: resolveImageUrl(item.imageUrl, sourceUrl), kind: item.kind }));
        const candidateImage = proposals.map((item) => item.imageUrl).find((url) => url && normalizePublicUrl(url));
        for (const field of fields.filter((item) => item.visual)) {
          const current = proposals.find((item) => item.key === field.key);
          if ((!current || current.value === null || !current.quote || current.kind === "image") && candidateImage) {
            const vision = await inspectImage(candidateImage, field);
            if (vision) proposals.push(vision);
          }
        }
        records.push({ sourceUrl, fields: proposals });
      } catch (error) {
        errors.push(`${sourceUrl}: ${error instanceof Error ? error.message : "Extraction failed"}`);
      }
    }
  } finally {
    await stagehand.close();
  }
  return { records, errors };
}
