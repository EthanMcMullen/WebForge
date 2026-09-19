import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeExtractedData } from "../src/lib/extraction.ts";
import { addCombinedSource, createCombinedRecord } from "../src/lib/source-merge.ts";

const schema = { phone_name: { type: "string" as const }, display_inches: { type: "number" as const },
  storage_gb: { type: "integer" as const }, single_core_score: { type: "integer" as const },
  battery_mah: { type: "integer" as const }, source_url: { type: "string" as const } };

test("combined extraction accepts sparse pages and tracks each populated field", () => {
  const benchmark = normalizeExtractedData({ single_core_score: 3400 }, schema, "https://benchmark.example/phone", true);
  assert.equal(benchmark.single_core_score, 3400);
  const record = createCombinedRecord(schema);
  addCombinedSource(record, { phone_name: "Apple iPhone 16 Pro", display_inches: 6.3 }, "https://apple.example/specs");
  addCombinedSource(record, benchmark, "https://benchmark.example/phone");
  assert.equal(record.data.single_core_score, 3400);
  assert.equal(record.data.source_url, "https://apple.example/specs");
  assert.equal(record.fieldSources.single_core_score, "https://benchmark.example/phone");
  assert.deepEqual(record.sourceUrls, ["https://apple.example/specs", "https://benchmark.example/phone"]);
});

test("conflicting phone variant cannot contribute a benchmark score", () => {
  const record = createCombinedRecord(schema);
  addCombinedSource(record, { phone_name: "iPhone 16 Pro", display_inches: 6.3 }, "https://apple.example/pro");
  assert.throws(() => addCombinedSource(record, { phone_name: "iPhone 16 Pro Max", single_core_score: 3500 },
    "https://bench.example/max"), /identity conflicts/);
  assert.equal(record.data.single_core_score, null);
  assert.equal(record.sourceUrls.length, 1);
});

test("conflicting non-identity values remain sourced to the first page and are flagged", () => {
  const record = createCombinedRecord(schema);
  addCombinedSource(record, { phone_name: "iPhone 16 Pro", display_inches: 6.3 }, "https://apple.example/pro");
  addCombinedSource(record, { phone_name: "Apple iPhone 16 Pro", display_inches: 6.4, single_core_score: 3400 },
    "https://bench.example/pro");
  assert.equal(record.data.display_inches, 6.3);
  assert.equal(record.fieldSources.display_inches, "https://apple.example/pro");
  assert.deepEqual(record.conflicts, ["display_inches"]);
});
