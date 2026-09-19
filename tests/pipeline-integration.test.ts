import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { ApiJob, ApiRecordData, SourceCandidate } from "../src/lib/types.ts";

const directory = mkdtempSync(join(tmpdir(), "webforge-pipeline-"));
process.env.WEBFORGE_DB_PATH = join(directory, "test.sqlite");
after(() => {
  globalThis.webforgeDatabase?.close();
  globalThis.webforgeDatabase = undefined;
  rmSync(directory, { recursive: true, force: true });
});

const store = await import("../src/lib/store.ts");
const { runApiJob } = await import("../src/lib/pipeline.ts");

function job(strategy: "automatic" | "provided_urls", request = "Golden Delicious apples at Walmart"): ApiJob {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), name: "Test", userRequest: request, status: "planned",
    schema: { item_name: { type: "string" }, source_url: { type: "string" } },
    proposedSchema: {}, schemaConfirmedAt: now,
    sourceStrategy: { type: strategy, searchQueries: ["Golden Delicious apples Walmart"] },
    sources: strategy === "provided_urls" ? ["https://example.com/apple"] : [],
    refreshInterval: null, error: null, createdAt: now, updatedAt: now,
  };
}
const apple: ApiRecordData = { item_name: "Golden Delicious apple", source_url: "https://example.com/apple" };
const source: SourceCandidate = { url: "https://example.com/apple", title: "Golden Delicious apple" };

test("full pipeline rejects a wrong retailer record after extraction", async () => {
  const api = job("automatic");
  store.saveApiJob(api);
  const calls: string[] = [];
  const result = await runApiJob(api.id, {
    async discover() { calls.push("search"); return [source]; },
    async extract() { calls.push("scrape"); return { data: { ...apple, item_name: "Gala apple at another store" }, identity: "Gala apple at another store" }; },
  }, async () => ({ action: "stop", query: null }), async (_request, candidates) => candidates,
  undefined, async () => false, async () => null);
  assert.deepEqual(calls, ["search", "scrape"]);
  assert.equal(result.status, "failed");
  assert.equal(store.countApiRecords(api.id), 0);
  assert.equal(result.runSummary?.totalFailures, 1);
});

test("source-less retailer typo suggests a correction without changing the request", async () => {
  const api = job("automatic", "Find fresh apples at Fresco Canada");
  api.sourceStrategy.searchQueries = ["Fresco Canada fresh apple price"];
  store.saveApiJob(api);
  const result = await runApiJob(api.id, {
    async discover() { return []; },
    async extract(): Promise<{ data: ApiRecordData; identity: string | null }> { throw new Error("Should not scrape"); },
  }, async () => ({ action: "stop", query: null }), async (_request, candidates) => candidates,
  undefined, async () => true, async () => "FreshCo Canada");
  assert.match(result.error || "", /Did you mean FreshCo Canada/);
  assert.equal(store.getApiJob(api.id)?.userRequest, "Find fresh apples at Fresco Canada");
  assert.equal(result.runSummary?.scrapeCalls, 0);
});

test("source-less search does not repeat the requested retailer as a correction", async () => {
  const api = job("automatic", "Find fresh apples at Fresco Canada");
  store.saveApiJob(api);
  const result = await runApiJob(api.id, {
    async discover() { return []; },
    async extract(): Promise<{ data: ApiRecordData; identity: string | null }> { throw new Error("Should not scrape"); },
  }, async () => ({ action: "stop", query: null }), async (_request, candidates) => candidates,
  undefined, async () => true, async () => "Fresco Canada");
  assert.doesNotMatch(result.error || "", /Did you mean/);
});

test("price job rejects null prices before record review or storage", async () => {
  const api = job("provided_urls", "AirPods price on Amazon");
  api.sources = ["https://www.amazon.com/dp/B012345678"];
  api.schema = { product_name: { type: "string" }, price: { type: "number" } };
  store.saveApiJob(api);
  let reviewed = false;
  const result = await runApiJob(api.id, {
    async discover() { return []; },
    async extract() { return { data: { product_name: "AirPods", price: null }, identity: "AirPods" }; },
  }, undefined, undefined, undefined, async () => { reviewed = true; return true; });
  assert.equal(reviewed, false);
  assert.equal(result.status, "failed");
  assert.equal(store.countApiRecords(api.id), 0);
});

test("failed refresh preserves previously saved records", async () => {
  const api = job("provided_urls");
  store.saveApiJob(api);
  const provider = {
    async discover() { return []; },
    async extract() { return { data: apple, identity: "Golden Delicious apple at Walmart" }; },
  };
  const accepted = async () => true;
  await runApiJob(api.id, provider, undefined, undefined, undefined, accepted);
  assert.equal(store.countApiRecords(api.id), 1);
  const result = await runApiJob(api.id, {
    ...provider,
    async extract(): Promise<{ data: ApiRecordData; identity: string | null }> { throw new Error("No structured JSON"); },
  }, undefined, undefined, undefined, accepted);
  assert.equal(store.countApiRecords(api.id), 1);
  assert.equal(result.status, "partial");
  assert.equal(store.listApiJobRuns(api.id).length, 2);
});

test("two URLs enrich one phone record with field provenance", async () => {
  const api = job("provided_urls", "Combine iPhone 16 Pro specs from Apple and benchmark results for the same phone");
  api.combineSources = true;
  api.sources = ["https://www.apple.com/iphone-16-pro/specs/", "https://browser.geekbench.com/ios_devices/iphone-16-pro"];
  api.schema = { phone_name: { type: "string" }, display_inches: { type: "number" },
    single_core_score: { type: "integer" }, source_url: { type: "string" } };
  store.saveApiJob(api);
  const reviewedPrior: Array<string | null | undefined> = [];
  const provider = {
    async discover() { return []; },
    async extract(url: string, _schema: unknown, _title?: string, _request?: string, combine?: boolean) {
      assert.equal(combine, true);
      return url.includes("apple.com")
        ? { data: { phone_name: "Apple iPhone 16 Pro", display_inches: 6.3, single_core_score: null }, identity: "iPhone 16 Pro" }
        : { data: { phone_name: "iPhone 16 Pro", display_inches: null, single_core_score: 3400 }, identity: "iPhone 16 Pro" };
    },
  };
  const accept = async (_request: string, _data: ApiRecordData, _url: string, _title?: string,
    _query?: string | null, _identity?: string | null, _combine?: boolean, prior?: string | null) => {
    reviewedPrior.push(prior); return true;
  };
  const result = await runApiJob(api.id, provider, undefined, undefined, undefined, accept);
  assert.equal(result.status, "ready");
  assert.equal(result.runSummary?.savedRecords, 1);
  assert.deepEqual(reviewedPrior, [null, "iPhone 16 Pro"]);
  const [record] = store.listApiRecords(api.id);
  assert.equal(store.countApiRecords(api.id), 1);
  assert.equal(record.data.display_inches, 6.3);
  assert.equal(record.data.single_core_score, 3400);
  assert.deepEqual(record.sourceUrls, api.sources);
  assert.equal(record.fieldSources?.display_inches, api.sources[0]);
  assert.equal(record.fieldSources?.single_core_score, api.sources[1]);
  assert.equal(record.data.source_url, api.sources[0]);

  api.sources = ["https://www.apple.com/iphone-16-pro/specs-new/", api.sources[1]];
  store.saveApiJob(api);
  await runApiJob(api.id, provider, undefined, undefined, undefined, accept);
  assert.equal(store.countApiRecords(api.id), 1);
  assert.equal(store.listApiRecords(api.id)[0].sourceUrl, api.sources[0]);
});

test("combined record refuses a second phone model and keeps verified first-source fields", async () => {
  const api = job("provided_urls", "Combine iPhone 16 Pro specs and its benchmark");
  api.combineSources = true;
  api.sources = ["https://example.com/pro", "https://example.org/max"];
  api.schema = { phone_name: { type: "string" }, display_inches: { type: "number" },
    single_core_score: { type: "integer" }, source_url: { type: "string" } };
  store.saveApiJob(api);
  const result = await runApiJob(api.id, {
    async discover() { return []; },
    async extract(url: string) { return url.endsWith("/pro")
      ? { data: { phone_name: "iPhone 16 Pro", display_inches: 6.3, single_core_score: null }, identity: "iPhone 16 Pro" }
      : { data: { phone_name: "iPhone 16 Pro Max", display_inches: null, single_core_score: 3500 }, identity: "iPhone 16 Pro Max" }; },
  }, undefined, undefined, undefined, async () => true);
  assert.equal(result.status, "partial");
  assert.equal(result.runSummary?.totalFailures, 1);
  assert.equal(store.countApiRecords(api.id), 1);
  assert.equal(store.listApiRecords(api.id)[0].data.single_core_score, null);
  assert.deepEqual(store.listApiRecords(api.id)[0].sourceUrls, [api.sources[0]]);
});

test("automatic combined jobs search complementary sites and publish one API record", async () => {
  const api = job("automatic", "iPhone 16 Pro display size from Apple and benchmark score from Geekbench");
  api.combineSources = true;
  api.sourceStrategy.searchQueries = ["iPhone 16 Pro display site:apple.com", "iPhone 16 Pro single core site:browser.geekbench.com"];
  api.schema = { phone_name: { type: "string" }, display_inches: { type: "number" },
    single_core_score: { type: "integer" }, source_url: { type: "string" } };
  store.saveApiJob(api);
  const queries: string[] = [];
  const result = await runApiJob(api.id, {
    async discover(query) { queries.push(query); return [{ url: query.includes("apple.com")
      ? "https://www.apple.com/iphone-16-pro/specs/" : "https://browser.geekbench.com/ios_devices/iphone-16-pro" }]; },
    async extract(url) { return url.includes("apple.com")
      ? { data: { phone_name: "iPhone 16 Pro", display_inches: 6.3, single_core_score: null }, identity: "iPhone 16 Pro" }
      : { data: { phone_name: "iPhone 16 Pro", display_inches: null, single_core_score: 3400 }, identity: "iPhone 16 Pro" }; },
  }, undefined, async (_request, candidates, _query, combine) => { assert.equal(combine, true); return candidates; },
  undefined, async () => true);
  assert.deepEqual(queries, api.sourceStrategy.searchQueries);
  assert.equal(result.status, "ready");
  assert.equal(result.runSummary?.savedRecords, 1);
  assert.equal(store.listApiRecords(api.id)[0].sourceUrls?.length, 2);
});

test("incomplete combined refresh keeps the previous complete phone record", async () => {
  const api = job("provided_urls", "Combine iPhone 16 Pro specs and benchmark");
  api.combineSources = true;
  api.sources = ["https://example.com/specs", "https://example.org/bench"];
  api.schema = { phone_name: { type: "string" }, display_inches: { type: "number" },
    single_core_score: { type: "integer" }, source_url: { type: "string" } };
  api.refreshInterval = 15;
  store.saveApiJob(api);
  const provider = (benchmarkWorks: boolean) => ({
    async discover() { return []; },
    async extract(url: string) {
      if (url.includes("specs")) return { data: { phone_name: "iPhone 16 Pro", display_inches: 6.3,
        single_core_score: null }, identity: "iPhone 16 Pro" };
      if (!benchmarkWorks) throw new Error("Source returned HTTP 503.");
      return { data: { phone_name: "iPhone 16 Pro", display_inches: null,
        single_core_score: 3400 }, identity: "iPhone 16 Pro" };
    },
  });
  await runApiJob(api.id, provider(true), undefined, undefined, undefined, async () => true);
  const original = store.listApiRecords(api.id)[0];
  const result = await runApiJob(api.id, provider(false), undefined, undefined, undefined, async () => true);
  assert.equal(result.status, "partial");
  assert.equal(result.runSummary?.savedRecords, 0);
  assert.equal(store.listApiRecords(api.id)[0].data.single_core_score, 3400);
  assert.equal(store.listApiRecords(api.id)[0].extractedAt, original.extractedAt);
  assert.match(result.error || "", /Kept the previous record/);
});

test("queue prevents overlap, cancellation and expired leases recover", async () => {
  const api = job("provided_urls");
  store.saveApiJob(api);
  store.enqueueApiRun(api.id);
  assert.throws(() => store.enqueueApiRun(api.id), /already has a queued/);
  const claimed = store.claimNextRun();
  assert.equal(claimed?.jobId, api.id);
  store.requestRunCancellation(api.id);
  assert.equal(store.isRunCancelled(claimed!.id), true);
  const result = await runApiJob(api.id, {
    async discover() { return []; },
    async extract() { return { data: apple, identity: "Golden Delicious apple at Walmart" }; },
  }, undefined, undefined, claimed!, async () => true);
  assert.equal(result.runSummary?.outcome, "cancelled");
  assert.equal(store.countApiRecords(api.id), 0);
  store.enqueueApiRun(api.id);
  const db = new DatabaseSync(process.env.WEBFORGE_DB_PATH!);
  db.prepare("UPDATE api_job_runs SET outcome = 'running', lease_until = ? WHERE outcome = 'queued'").run("2020-01-01T00:00:00.000Z");
  db.close();
  assert.equal(store.claimNextRun()?.jobId, api.id);
});

test("cancellation during record review prevents storage", async () => {
  const api = job("provided_urls");
  store.saveApiJob(api);
  store.enqueueApiRun(api.id);
  const claimed = store.claimNextRun()!;
  const result = await runApiJob(api.id, {
    async discover() { return []; },
    async extract() { return { data: apple, identity: "Golden Delicious apple at Walmart" }; },
  }, undefined, undefined, claimed, async () => {
    store.requestRunCancellation(api.id);
    return true;
  });
  assert.equal(result.runSummary?.outcome, "cancelled");
  assert.equal(store.countApiRecords(api.id), 0);
});

test("recovered runs retain paid-call limits across a restart", async () => {
  const api = job("provided_urls");
  store.saveApiJob(api);
  store.enqueueApiRun(api.id);
  const first = store.claimNextRun()!;
  store.saveRunSummary({ id: first.id, jobId: api.id, startedAt: new Date().toISOString(), finishedAt: null,
    searchCalls: 0, scrapeCalls: 5, recoveryCalls: 0, consecutiveFailures: 0, totalFailures: 0,
    savedRecords: 0, skippedSources: 0, outcome: "running", stopReason: null, trigger: "manual" });
  const db = new DatabaseSync(process.env.WEBFORGE_DB_PATH!);
  db.prepare("UPDATE api_job_runs SET lease_until = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", first.id);
  db.close();
  const resumed = store.claimNextRun()!;
  assert.equal(resumed.id, first.id);
  let scrapes = 0;
  const result = await runApiJob(api.id, {
    async discover() { return []; },
    async extract() { scrapes++; return { data: apple, identity: "Golden Delicious apple at Walmart" }; },
  }, undefined, undefined, resumed, async () => true);
  assert.equal(scrapes, 0);
  assert.equal(result.runSummary?.scrapeCalls, 5);
});

test("scheduled refresh queues once and pauses after two failed cycles", () => {
  const api = job("provided_urls");
  api.refreshInterval = 15;
  store.saveApiJob(api);
  const db = new DatabaseSync(process.env.WEBFORGE_DB_PATH!);
  db.prepare("UPDATE api_jobs SET next_refresh_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", api.id);
  assert.equal(store.enqueueDueRefreshes(), 1);
  assert.equal(store.enqueueDueRefreshes(), 0);
  const claimed = store.claimNextRun();
  assert.equal(claimed?.trigger, "scheduled");
  store.saveRunSummary({ id: claimed!.id, jobId: api.id, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    searchCalls: 0, scrapeCalls: 0, recoveryCalls: 0, consecutiveFailures: 0, totalFailures: 0,
    savedRecords: 0, skippedSources: 0, outcome: "failed", stopReason: "test", trigger: "scheduled" });
  store.finishRefreshSchedule(api.id, "scheduled", "failed");
  assert.equal(store.getApiJob(api.id)?.refreshFailures, 1);
  store.finishRefreshSchedule(api.id, "scheduled", "failed");
  assert.equal(store.getApiJob(api.id)?.refreshPaused, true);
  assert.equal(store.getApiJob(api.id)?.nextRefreshAt, null);
  db.close();
});

test("scheduled partial runs with no usable new records pause after two cycles", () => {
  const api = job("provided_urls");
  api.refreshInterval = 15;
  store.saveApiJob(api);
  store.finishRefreshSchedule(api.id, "scheduled", "partial_stopped", 0);
  assert.equal(store.getApiJob(api.id)?.refreshFailures, 1);
  store.finishRefreshSchedule(api.id, "scheduled", "partial_stopped", 0);
  assert.equal(store.getApiJob(api.id)?.refreshPaused, true);
  assert.equal(store.getApiJob(api.id)?.nextRefreshAt, null);
});

test("a scheduled cycle that saves a record resets the no-progress count", () => {
  const api = job("provided_urls");
  api.refreshInterval = 15;
  store.saveApiJob(api);
  store.finishRefreshSchedule(api.id, "scheduled", "ready", 0);
  assert.equal(store.getApiJob(api.id)?.refreshFailures, 1);
  store.finishRefreshSchedule(api.id, "scheduled", "ready", 1);
  assert.equal(store.getApiJob(api.id)?.refreshFailures, 0);
  assert.equal(store.getApiJob(api.id)?.refreshPaused, false);
});
