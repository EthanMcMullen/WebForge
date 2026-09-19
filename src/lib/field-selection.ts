import type { ApiRecordSchema } from "./types.ts";

export function selectProposedFields(proposal: ApiRecordSchema, selectedFields: string[]): ApiRecordSchema {
  if (!proposal.source_url) throw new Error("The proposed schema is missing source_url.");
  if (selectedFields.length < 1 || selectedFields.length > 19) {
    throw new Error("Choose at least one and at most 19 data fields.");
  }
  const selected = new Set(selectedFields);
  if (selected.size !== selectedFields.length || selected.has("source_url")) {
    throw new Error("Choose unique data fields; source_url is always included.");
  }
  for (const key of selected) {
    if (!Object.hasOwn(proposal, key)) throw new Error(`Unknown proposed field: ${key}.`);
  }
  const schema: ApiRecordSchema = {};
  for (const [key, field] of Object.entries(proposal)) {
    if (key !== "source_url" && selected.has(key)) schema[key] = field;
  }
  schema.source_url = proposal.source_url;
  return schema;
}
