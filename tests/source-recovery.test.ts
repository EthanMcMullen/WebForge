import assert from "node:assert/strict";
import test from "node:test";
import { classifySourceError, filterCandidates, isBlockedDomain } from "../src/lib/source-support.ts";
import { RUN_LIMITS, canRecover, canScrape, canSearch } from "../src/lib/run-budget.ts";
import { validateRecoveryDecision, type RecoveryInput } from "../src/lib/source-recovery-validation.ts";
import { normalizeExtractedData } from "../src/lib/extraction.ts";

test("unsupported social domains are skipped before paid scraping", () => {
  const seen = new Set<string>();
  const candidates = filterCandidates([
    { url: "https://www.instagram.com/reel/example" },
    { url: "https://facebook.com/post/example" },
    { url: "https://example.org/search" },
    { url: "https://example.org/item/one", title: "One" },
    { url: "https://example.org/item/one#fragment" },
  ], ["instagram.com", "facebook.com"], seen, 8);
  assert.deepEqual(candidates.map((item) => item.url), ["https://example.org/item/one"]);
  assert.equal(isBlockedDomain("sub.instagram.com", ["instagram.com"]), true);
  assert.deepEqual(filterCandidates([{ url: "https://example.org/two" }], [], seen, 0), []);
});

test("Firecrawl errors are normalized without forwarding provider text", () => {
  assert.equal(classifySourceError(new Error("We apologize for the inconvenience but we do not support this site.")), "UNSUPPORTED_SITE");
  assert.equal(classifySourceError(new Error("Firecrawl returned no structured JSON object.")), "NO_STRUCTURED_JSON");
  assert.equal(classifySourceError(Object.assign(new Error("Forbidden"), { status: 403 })), "ACCESS_BLOCKED");
  assert.equal(classifySourceError(Object.assign(new Error("Source returned HTTP 401."), { status: 401 })), "ACCESS_BLOCKED");
  assert.equal(classifySourceError(Object.assign(new Error("No credits"), { status: 429 })), "RATE_LIMITED");
  assert.equal(classifySourceError(Object.assign(new Error("Payment required"), { status: 402 })), "CONFIG_OR_BILLING");
});

test("all-null extraction cannot become a stored record", () => {
  assert.throws(() => normalizeExtractedData({ title: null }, {
    title: { type: "string" }, source_url: { type: "string" },
  }, "https://example.org/item"), /no usable fields/);
});

test("recovery query is validated once and cannot target excluded domains", () => {
  const input: RecoveryInput = {
    userRequest: "Find landmark facts", priorQueries: ["landmark detail pages"],
    failureCodes: [{ domain: "instagram.com", code: "UNSUPPORTED_SITE" }],
    excludedDomains: ["instagram.com"], successfulRecordCount: 0,
  };
  assert.deepEqual(validateRecoveryDecision({ action: "search_again", query: "Eiffel Tower official facts" }, input),
    { action: "search_again", query: "Eiffel Tower official facts" });
  for (const query of ["https://example.com", "landmark detail pages", "site:instagram.com Eiffel", "localhost facts"]) {
    assert.equal(validateRecoveryDecision({ action: "search_again", query }, input).action, "stop");
  }
  assert.equal(validateRecoveryDecision({ action: "stop", query: null }, input).action, "stop");
  assert.equal(validateRecoveryDecision({ action: "search_again", query: 5 }, input).action, "stop");
});

test("request budgets prevent extra recovery and scrape calls", () => {
  const now = Date.now();
  assert.equal(RUN_LIMITS.searches, 2);
  assert.equal(RUN_LIMITS.scrapes, 3);
  assert.equal(RUN_LIMITS.recoveryCalls, 1);
  assert.equal(canSearch(2, now), false);
  assert.equal(canScrape(3, 0, 0, now), false);
  assert.equal(canScrape(1, 3, 3, now), false);
  assert.equal(canRecover(1, 2, 0, 0, 2, 2, now), true);
  assert.equal(canRecover(1, 2, 1, 0, 2, 2, now), false);
  assert.equal(canRecover(1, 2, 0, 0, 3, 3, now), false);
  assert.equal(canRecover(1, 2, 0, 0, 0, 0, now - RUN_LIMITS.durationMs - 1), false);
});
