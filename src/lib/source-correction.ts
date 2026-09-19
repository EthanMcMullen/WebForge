import "server-only";
import OpenAI from "openai";

const responseSchema = {
  type: "object",
  properties: { suggestion: { type: ["string", "null"] } },
  required: ["suggestion"], additionalProperties: false,
} as const;

export function parseSourceSuggestion(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const suggestion = (value as { suggestion?: unknown }).suggestion;
  if (suggestion === null) return null;
  if (typeof suggestion !== "string" || suggestion.trim().length < 2 || suggestion.length > 80 || /https?:|[\r\n]/i.test(suggestion)) return null;
  return suggestion.trim();
}

export async function suggestSourceCorrection(request: string, queries: string[]): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 12_000 }).responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    instructions: [
      "A web search found no usable pages. Check whether a retailer or source name in the request is a likely typo.",
      "If highly confident, return only the corrected name in suggestion. For example, Fresco Canada may mean FreshCo Canada.",
      "Otherwise return null. Do not silently change the requested source or invent a website.",
    ].join(" "),
    input: JSON.stringify({ request, queries }),
    max_output_tokens: 100,
    text: { format: { type: "json_schema", name: "source_correction", strict: true, schema: responseSchema } },
  });
  return parseSourceSuggestion(JSON.parse(response.output_text || "null"));
}
