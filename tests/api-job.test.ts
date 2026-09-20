import assert from "node:assert/strict";
import test from "node:test";
import { apiJobStatuses, toApiJobResponse, toApiRecordResponse, type ApiJob } from "../src/lib/types.ts";
import { extractionJsonSchema, normalizeExtractedData, selectSourceUrls } from "../src/lib/extraction.ts";
import { ApiRecordSchemaInput, CreateApiJobInput, cleanSourceUrls, normalizePublicUrl } from "../src/lib/validation.ts";

test("API jobs support every pipeline lifecycle status", () => {
  assert.deepEqual(apiJobStatuses, [
    "planning", "awaiting_fields", "planned", "queued", "discovering", "scraping", "extracting", "storing", "ready", "partial", "failed",
  ]);
});

test("API job input applies safe defaults", () => {
  const input = CreateApiJobInput.parse({
    user_request: "Track major cybersecurity incidents affecting public companies.",
  });
  assert.deepEqual(input.source_strategy, { type: "automatic", search_queries: [] });
  assert.deepEqual(input.sources, []);
  assert.equal(input.refresh_interval, null);
  assert.equal(input.combine_sources, false);
  assert.equal(input.search_depth, "balanced");
});

test("provided URL strategy requires sources", () => {
  const result = CreateApiJobInput.safeParse({
    user_request: "Track major cybersecurity incidents affecting public companies.",
    source_strategy: { type: "provided_urls" },
  });
  assert.equal(result.success, false);
});

test("record schemas validate field names and supported types", () => {
  const schema = ApiRecordSchemaInput.parse({
    title: { type: "string", description: "Name of the incident" },
    severity: { type: "string" },
    source_url: { type: "string" },
  });
  assert.equal(schema.title.type, "string");
  assert.equal(ApiRecordSchemaInput.safeParse({ "Invalid Field": { type: "date" } }).success, false);
});

test("only unique public web URLs are accepted as sources", () => {
  assert.equal(normalizePublicUrl("http://localhost:3000/private"), null);
  assert.equal(normalizePublicUrl("http://127.0.0.1/private"), null);
  assert.equal(normalizePublicUrl("https://user:pass@example.com/item"), null);
  assert.equal(normalizePublicUrl("file:///etc/passwd"), null);
  assert.deepEqual(cleanSourceUrls(["https://example.com/item#details", "https://example.com/item"]), ["https://example.com/item"]);
});

test("API responses use the public snake_case contract", () => {
  const job: ApiJob = {
    id: "job-1",
    name: "Cybersecurity incidents",
    userRequest: "Track major cybersecurity incidents affecting public companies.",
    status: "ready",
    schema: { title: { type: "string" }, source_url: { type: "string" } },
    sourceStrategy: { type: "automatic", searchQueries: ["public company cybersecurity incidents"] },
    searchDepth: "deep",
    sources: [],
    refreshInterval: 1440,
    error: null,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
  };
  const response = toApiJobResponse(job);
  assert.equal(response.user_request, job.userRequest);
  assert.equal(response.refresh_interval, 1440);
  assert.equal(response.combine_sources, false);
  assert.equal(response.search_depth, "deep");
  assert.deepEqual(response.source_strategy.search_queries, job.sourceStrategy.searchQueries);
  assert.equal("userRequest" in response, false);
  assert.deepEqual(response.proposed_schema, {});
  const draft = toApiJobResponse({
    ...job, status: "awaiting_fields", schema: {},
    proposedSchema: { title: { type: "string" }, source_url: { type: "string" } },
    schemaConfirmedAt: null,
  });
  assert.deepEqual(Object.keys(draft.proposed_schema), ["title", "source_url"]);
  assert.deepEqual(draft.schema, {});
});

test("run responses show vision attempts and successful uses without inventing legacy history", () => {
  const job: ApiJob = {
    id: "job-vision", name: "Vision example", userRequest: "Track a product price", status: "ready",
    schema: { price: { type: "number" }, source_url: { type: "string" } },
    sourceStrategy: { type: "provided_urls", searchQueries: [] }, searchDepth: "balanced",
    sources: ["https://shop.example/item"], refreshInterval: null, error: null,
    createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z",
    runSummary: {
      id: "run-vision", jobId: "job-vision", startedAt: "2026-09-20T00:00:00.000Z", finishedAt: null,
      searchCalls: 0, scrapeCalls: 2, recoveryCalls: 0, consecutiveFailures: 0, totalFailures: 0,
      savedRecords: 1, skippedSources: 0, outcome: "ready", stopReason: null,
      visionAttempts: 1, visionRecoveries: 1,
      attempts: [{ url: "https://shop.example/item", query: null, stage: "save", code: "SAVED",
        visionAttempted: true, viaVision: true }],
    },
  };
  const response = toApiJobResponse(job).run_summary;
  assert.equal(response?.vision_attempts, 1);
  assert.equal(response?.vision_recoveries, 1);
  assert.equal(response?.attempts[0].viaVision, true);
  assert.equal(toApiJobResponse({ ...job, runSummary: { ...job.runSummary!, visionAttempts: undefined,
    visionRecoveries: undefined } }).run_summary?.vision_attempts, null);
});

test("record responses expose per-field sources alongside the primary URL", () => {
  const record = toApiRecordResponse({ id: "r1", jobId: "j1", sourceUrl: "https://apple.example/specs",
    sourceUrls: ["https://apple.example/specs", "https://bench.example/results"],
    fieldSources: { display_inches: "https://apple.example/specs", score: "https://bench.example/results" },
    data: { display_inches: 6.3, score: 3400, source_url: "https://apple.example/specs" },
    extractedAt: "2026-09-19T00:00:00.000Z" });
  assert.deepEqual(record.source_urls, ["https://apple.example/specs", "https://bench.example/results"]);
  assert.equal(record.field_sources.score, "https://bench.example/results");
});


test("extraction requests nullable typed fields and adds server provenance", () => {
  const schema = { title: { type: "string" as const }, price: { type: "number" as const }, source_url: { type: "string" as const } };
  const firecrawlSchema = extractionJsonSchema(schema);
  assert.deepEqual(firecrawlSchema.required, ["title", "price"]);
  assert.deepEqual(normalizeExtractedData({ title: "Laptop", price: null, extra: "ignored" }, schema, "https://example.com/item"), {
    title: "Laptop", price: null, source_url: "https://example.com/item",
  });
  assert.throws(() => normalizeExtractedData({ title: "Laptop", price: "999" }, schema, "https://example.com/item"));
});


test("search results yield at most five unique public URLs", () => {
  const results = [
    { url: "https://example.com/one#section" },
    { metadata: { sourceURL: "https://example.com/one" } },
    { url: "http://localhost/private" },
    { url: "https://example.com/two" },
  ];
  assert.deepEqual(selectSourceUrls(results), ["https://example.com/one", "https://example.com/two"]);
  assert.deepEqual(selectSourceUrls(results, 1), ["https://example.com/one"]);
});


test("sparse extraction cannot masquerade as a complete API record", () => {
  const schema = Object.fromEntries(["event_id", "timestamp", "source_ip", "destination_ip", "protocol", "event_type", "data_volume_bytes", "success"].map((key) => [key, { type: key === "success" ? "boolean" : "string" }])) as import("../src/lib/types.ts").ApiRecordSchema;
  assert.throws(() => normalizeExtractedData({ timestamp: "2025-02-27T00:00:00Z" }, schema, "https://example.com/unrelated"), /incomplete record/);
});
