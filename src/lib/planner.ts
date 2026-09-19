import "server-only";

import OpenAI from "openai";
import { z } from "zod";
import type { Plan } from "./types";

const PlanSchema = z.object({
  name: z.string().min(3).max(80),
  fields: z.array(z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1).max(60),
    type: z.enum(["string", "number", "boolean"]),
    visual: z.boolean(),
  })).min(1).max(8),
  searchQueries: z.array(z.string().min(3).max(160)).min(1).max(3),
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
          key: { type: "string" }, label: { type: "string" },
          type: { type: "string", enum: ["string", "number", "boolean"] },
          visual: { type: "boolean" },
        },
        required: ["key", "label", "type", "visual"], additionalProperties: false,
      },
    },
    searchQueries: { type: "array", items: { type: "string" } },
  },
  required: ["name", "fields", "searchQueries"], additionalProperties: false,
} as const;

export async function planRequest(prompt: string): Promise<Plan> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for live mode.");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    instructions: "Turn a public-web data request into a small typed extraction plan. Use snake_case field keys, at most eight fields, and 1-3 concise search queries for product or source pages. Mark visual=true only if images could add evidence. Do not include private or login-only sources.",
    input: prompt,
    text: { format: { type: "json_schema", name: "web_data_plan", strict: true, schema: planJsonSchema } },
  });
  if (!response.output_text) throw new Error("The planning model returned no data.");
  const plan = PlanSchema.parse(JSON.parse(response.output_text));
  if (new Set(plan.fields.map((field) => field.key)).size !== plan.fields.length) {
    throw new Error("The planning model returned duplicate field names.");
  }
  return plan;
}
