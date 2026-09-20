import assert from "node:assert/strict";
import test from "node:test";
import { isExpectedScrapeCap, presentRunResult } from "../src/lib/run-presentation.ts";

test("a successful automatic fallback does not show a job error", () => {
  const result = presentRunResult({
    automatic: true, hasRecords: true, savedRecords: 1, stopReason: null,
    errors: ["https://business.walmart.com/c/brand/good-apple: no structured json"],
    expectedCap: false,
  });
  assert.deepEqual(result, { outcome: "ready", stopReason: null, warning: null });
});

test("explicit source failure stays visible when another provided URL succeeds", () => {
  const result = presentRunResult({
    automatic: false, hasRecords: true, savedRecords: 1, stopReason: null,
    errors: ["https://example.com/second: no structured json"], expectedCap: false,
  });
  assert.equal(result.outcome, "partial_stopped");
  assert.match(result.warning || "", /second/);
});

test("fatal stop stays visible even when earlier records exist", () => {
  const result = presentRunResult({
    automatic: true, hasRecords: true, savedRecords: 1,
    stopReason: "Firecrawl stopped: rate limited.", errors: [], expectedCap: false,
  });
  assert.equal(result.outcome, "partial_stopped");
  assert.match(result.warning || "", /rate limited/);
});

test("automatic run is ready after recovering a complete record from a later source", () => {
  const result = presentRunResult({ automatic: true, hasRecords: true, savedRecords: 1,
    stopReason: null, errors: ["first product page had no verifiable price"], expectedCap: false });
  assert.equal(result.outcome, "ready");
  assert.equal(result.stopReason, null);
});

test("a successful automatic run at its planned scrape cap has no warning, even after vision fallback", () => {
  const legacyReason = "Stopped at the 6-scrape balanced search-depth limit. Vision fallback recovered 1 source from page screenshots.";
  assert.equal(isExpectedScrapeCap(legacyReason), true);
  assert.equal(isExpectedScrapeCap("Stopped at the 6-scrape balanced search-depth limit. Missing fields across sources: price."), false);
  const result = presentRunResult({ automatic: true, hasRecords: true, savedRecords: 3,
    stopReason: legacyReason, errors: ["https://example.com/failed: unverified price"], expectedCap: true });
  assert.deepEqual(result, { outcome: "ready", stopReason: null, warning: null });
});
