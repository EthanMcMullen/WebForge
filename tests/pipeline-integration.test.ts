import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { ApiJob, ApiRecordData, SourceCandidate } from "../src/lib/types.ts";

const directory = mkdtempSync(join(tmpdir(), "webforge-pipeline-"));
process.env.WEBFORGE_DB_PATH = join(directory, "test.sqlite");
after(() => rmSync(directory, { recursive: true, force: true }));

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
