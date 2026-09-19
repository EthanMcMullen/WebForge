import assert from "node:assert/strict";
import test from "node:test";
import { presentRunResult } from "../src/lib/run-presentation.ts";

test("a successful automatic fallback does not show a job error", () => {
  const result = presentRunResult({
    automatic: true, hasRecords: true, savedRecords: 1, stopReason: null,
    errors: ["https://business.walmart.com/c/brand/good-apple: no structured json"],
    expectedCap: false,
  });
  assert.deepEqual(result, { outcome: "partial_stopped", stopReason: "1 source(s) skipped or failed.", warning: null });
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
