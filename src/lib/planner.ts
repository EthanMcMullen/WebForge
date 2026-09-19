import "server-only";

import OpenAI from "openai";
import { z } from "zod";
import type { ApiPlan, ApiRecordSchema } from "./types";

const PlannedFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  type: z.enum(["string", "number", "integer", "boolean"]),
  description: z.string().min(1).max(300),
});

const PlanSchema = z.object({
  name: z.string().min(3).max(100),
  fields: z.array(PlannedFieldSchema).min(1).max(19),
  searchQueries: z.array(z.string().min(3).max(200)).min(1).max(5),
});

const planJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          type: { type: "string", enum: ["string", "number", "integer", "boolean"] },
          description: { type: "string" },
        },
        required: ["key", "type", "description"],
        additionalProperties: false,
      },
    },
    searchQueries: { type: "array", items: { type: "string" } },
  },
  required: ["name", "fields", "searchQueries"],
  additionalProperties: false,
} as const;

export async function planApiJob(userRequest: string): Promise<ApiPlan> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to plan an API job.");

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    instructions: [
      "Turn the user's public-web data request into a reusable API record schema.",
      "Return a concise API name, one to nineteen fields, and one to five focused web search queries.",
      "Define one record as one individual page about an item, entity, or event. Return only fields needed for that record.",
      "Search queries should find individual pages, not broad lists. If the user names a website, include its domain with site: in a query.",
      "Never invent exact source URLs; search will provide real URLs.",
      "Use snake_case field keys and only string, number, integer, or boolean field types.",
      "Dates must be strings whose descriptions require ISO 8601 format.",
      "Do not add source_url; the platform adds that provenance field automatically.",
      "Do not plan image, screenshot, OCR, login-only, private, or inferred visual fields.",
    ].join(" "),
    input: userRequest,
    text: { format: { type: "json_schema", name: "api_job_plan", strict: true, schema: planJsonSchema } },
  });

  if (!response.output_text) throw new Error("The planning model returned no data.");
  const parsed = PlanSchema.parse(JSON.parse(response.output_text));
  if (new Set(parsed.fields.map((field) => field.key)).size !== parsed.fields.length) {
    throw new Error("The planning model returned duplicate field names.");
  }

  const schema: ApiRecordSchema = Object.fromEntries(
    parsed.fields.map((field) => [field.key, { type: field.type, description: field.description }]),
  );
  schema.source_url = {
    type: "string",
    description: "Public URL used as the primary source for this record",
  };

  return { name: parsed.name, schema, searchQueries: parsed.searchQueries };
}
