import type { ApiRecordData, ApiRecordSchema } from "./types.ts";

export interface CombinedRecord {
  data: ApiRecordData;
  sourceUrls: string[];
  fieldSources: Record<string, string>;
  conflicts: string[];
}

export function createCombinedRecord(schema: ApiRecordSchema): CombinedRecord {
  return { data: Object.fromEntries(Object.keys(schema).filter((key) => key !== "source_url").map((key) => [key, null])),
    sourceUrls: [], fieldSources: {}, conflicts: [] };
}

function entityName(value: string): string {
  return value.toLowerCase().replace(/^(apple|samsung|google)\s+/i, "")
    .replace(/\s+at\s+.+$/i, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Adds only fields a page actually supplied. Conflicting values remain attributed to the first source. */
export function addCombinedSource(record: CombinedRecord, incoming: ApiRecordData, url: string): number {
  const additions: Array<[string, string | number | boolean]> = [];
  const conflicts: string[] = [];
  for (const [key, current] of Object.entries(record.data)) {
    if (key === "source_url") continue;
    const value = incoming[key];
    if (value === null || value === undefined || value === "") continue;
    if (current !== null && /(?:^|_)(?:product_name|phone_name|item_name|model_name|model_version|asin|sku)$/.test(key) &&
        typeof current === "string" && typeof value === "string" && entityName(current) !== entityName(value)) {
      throw new Error(`Source identity conflicts on ${key}.`);
    }
    if (current !== null && current !== value && !record.conflicts.includes(key) &&
        !(typeof current === "string" && typeof value === "string" && entityName(current) === entityName(value))) {
      conflicts.push(key);
    }
    if (current === null) additions.push([key, value]);
  }
  for (const [key, value] of additions) {
    record.data[key] = value;
    record.fieldSources[key] = url;
  }
  if (additions.length) record.conflicts.push(...conflicts);
  if (additions.length) {
    record.sourceUrls.push(url);
    record.data.source_url = record.sourceUrls[0];
  }
  return additions.length;
}
