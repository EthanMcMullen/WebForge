import "server-only";

import OpenAI from "openai";
import { z } from "zod";
import type { ApiPlan, ApiRecordSchema } from "./types";
import { invalidPlanReason, recordScopeForRequest } from "./planner-guardrails";

const PlannedFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  type: z.enum(["string", "number", "integer", "boolean"]),
  description: z.string().min(1).max(300),
});

const PlanSchema = z.object({
  name: z.string().min(3).max(100),
  fields: z.array(PlannedFieldSchema).min(1).max(19),
  searchQueries: z.array(z.string().min(3).max(200)).min(1).max(5),
  combineSources: z.boolean(),
  recordScope: z.enum(["single", "collection"]),
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
    combineSources: { type: "boolean" },
    recordScope: { type: "string", enum: ["single", "collection"] },
  },
  required: ["name", "fields", "searchQueries", "combineSources", "recordScope"],
  additionalProperties: false,
} as const;

export async function planApiJob(userRequest: string, combineRequested = false): Promise<ApiPlan> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to plan an API job.");

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const makePlan = async (feedback?: string) => client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    instructions: [
      "Turn the user's public-web data request into a reusable API record schema.",
      "Return a concise API name, one to nineteen fields, one to five focused web search queries, and recordScope: single or collection.",
      "Define one record as one item, entity, or event. Return only fields explicitly requested, plus an item identity field and essential units or currency needed to interpret the requested value. Do not add availability, weight, store location, or derived unit prices unless asked.",
      "For a collection such as all courses or different espresso machines, set recordScope collection and combineSources false. One record represents one member. First search for an authoritative current list, catalog, or category page that names real members; then search individual member details if needed. For course cohorts, prefer the official current program term schedule or academic calendar over a general program marketing page or an old calendar archive. Do not choose a specific course or model as a stand-in for the whole collection. For explicitly named individual items, use a query per item. When combining sources, queries target complementary field groups for one exact entity.",
      "If the user wants one item enriched with facts from different sites (for example, official phone specs plus independent benchmarks), set combineSources true and provide a focused query for each source or field group. All queries must target the exact same model and variant. Otherwise set combineSources false.",
      "If combineRequested is true but the request asks for multiple distinct items, the collection intent wins: set combineSources false. Otherwise plan complementary source and field groups for one item.",
      "When combineSources is true, one record will merge fields from multiple pages. Prefer complementary authoritative pages; do not plan different models as sources for one record.",
      "Search queries should find individual pages, not broad lists. If the user gives an explicit domain, include it with site: in a query. A retailer name alone does not imply a country or top-level domain; search across that retailer's regional sites unless the user specifies a country.",
      "For a requested price, target an individual product detail page for the exact model and variant, not a retailer search result or category page. Do not invent a product URL or identifier.",
      "Preserve exact product type, variety, model, and retailer. For grocery fruit, target fresh fruit product pages rather than trees, seeds, plants, or dried fruit; include fresh and use exclusions such as -tree when helpful.",
      "Do not assume USD or another currency unless the user specifies it. If price is a field, describe it in the source's currency and consider a separate currency field.",
      "For an open-ended collection, use one or two distinct discovery queries for real items; do not return near-identical query variations, ranking terms such as best, or specific item names not supplied by the user. Never invent a representative model, person, course, product, domain, or placeholder such as XYZ. Avoid private logs and invented datasets.",
      "Only plan fields the user asked for, plus a stable identity and essential units. For 'all Waterloo ECE 1A classes', plan course code and title; do not add professor, room, or schedule. For 'different espresso machines and prices', plan machine name, price, and currency; make separate records and generic discovery queries.",
      "Never invent exact source URLs; search will provide real URLs.",
      "Use snake_case field keys and only string, number, integer, or boolean field types.",
      "Dates must be strings whose descriptions require ISO 8601 format.",
      "Do not add source_url; the platform adds that provenance field automatically.",
      "Do not plan image, screenshot, OCR, login-only, private, or inferred visual fields.",
    ].join(" "),
    input: JSON.stringify({ userRequest, combineRequested, ...(feedback ? { feedback } : {}) }),
    text: { format: { type: "json_schema", name: "api_job_plan", strict: true, schema: planJsonSchema } },
  });

  let response = await makePlan();
  if (!response.output_text) throw new Error("The planning model returned no data.");
  let parsed = PlanSchema.parse(JSON.parse(response.output_text));
  let reason = invalidPlanReason(parsed);
  if (reason) {
    response = await makePlan(`${reason} Revise the queries using only subjects in the user request; do not use example names.`);
    if (!response.output_text) throw new Error("The planning model returned no corrected data.");
    parsed = PlanSchema.parse(JSON.parse(response.output_text));
    reason = invalidPlanReason(parsed);
    if (reason) throw new Error(`Planning stopped before search: ${reason}`);
  }
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

  const recordScope = recordScopeForRequest(userRequest, parsed.recordScope);
  return { name: parsed.name, schema, searchQueries: parsed.searchQueries,
    combineSources: recordScope === "single" && (combineRequested || parsed.combineSources), recordScope };
}
