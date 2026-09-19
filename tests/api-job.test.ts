import assert from "node:assert/strict";
import test from "node:test";
import { apiJobStatuses, toApiJobResponse, type ApiJob } from "../src/lib/types.ts";
import { extractionJsonSchema, normalizeExtractedData, selectSourceUrls } from "../src/lib/extraction.ts";
import { ApiRecordSchemaInput, CreateApiJobInput, cleanSourceUrls, normalizePublicUrl } from "../src/lib/validation.ts";

test("API jobs support every pipeline lifecycle status", () => {
  assert.deepEqual(apiJobStatuses, [
    "planning", "planned", "discovering", "scraping", "extracting", "storing", "ready", "failed",
  ]);
});

test("API job input applies safe defaults", () => {
  const input = CreateApiJobInput.parse({
    user_request: "Track major cybersecurity incidents affecting public companies.",
  });
  assert.deepEqual(input.source_strategy, { type: "automatic", search_queries: [] });
  assert.deepEqual(input.sources, []);
  assert.equal(input.refresh_interval, null);
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
    sources: [],
    refreshInterval: 1440,
    error: null,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
  };
  const response = toApiJobResponse(job);
  assert.equal(response.user_request, job.userRequest);
  assert.equal(response.refresh_interval, 1440);
  assert.deepEqual(response.source_strategy.search_queries, job.sourceStrategy.searchQueries);
  assert.equal("userRequest" in response, false);
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
