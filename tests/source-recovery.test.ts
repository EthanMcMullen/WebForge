import assert from "node:assert/strict";
import test from "node:test";
import { classifySourceError, filterCandidates, isBlockedDomain } from "../src/lib/source-support.ts";
import { missingPlannedQueries, prioritizeSearchBatches } from "../src/lib/discovery-plan.ts";
import { RUN_LIMITS, canRecover, canScrape, canSearch, plannedSearchQueries, runLimitsForSearchDepth } from "../src/lib/run-budget.ts";
import { validateRecoveryDecision, type RecoveryInput } from "../src/lib/source-recovery-validation.ts";
import { normalizeCollectionData, normalizeExtractedData, verifiedProductProfile, verifyPriceEvidence } from "../src/lib/extraction.ts";
import { selectReviewedCandidates } from "../src/lib/source-review-validation.ts";

test("unsupported social domains are skipped before paid scraping", () => {
  const seen = new Set<string>();
  const candidates = filterCandidates([
    { url: "https://www.instagram.com/reel/example" },
    { url: "https://facebook.com/post/example" },
    { url: "https://example.org/search" },
    { url: "https://www.walmart.com/c/kp/golden-delicious", title: "Golden Delicious" },
    { url: "https://business.walmart.com/c/brand/good-apple", title: "Good Apple Brand" },
    { url: "https://example.org/item/one", title: "One" },
    { url: "https://example.org/item/one#fragment" },
  ], ["instagram.com", "facebook.com"], seen, 8);
  assert.deepEqual(candidates.map((item) => item.url), ["https://example.org/item/one"]);
  assert.equal(isBlockedDomain("sub.instagram.com", ["instagram.com"]), true);
  assert.deepEqual(filterCandidates([{ url: "https://example.org/two" }], [], seen, 0), []);
});

test("category snippets expose individual product links without scraping the category", () => {
  const seen = new Set<string>();
  const candidates = filterCandidates([{
    url: "https://www.walmart.com/c/kp/golden-delicious",
    title: "Golden Delicious Apples and Related Products",
    description: "[Fresh Golden Delicious Apple, Each, $0.89](https://www.walmart.com/ip/Fresh-Golden-Delicious-Apple-Each/44391046?classType=REGULAR) and [Apple Tree](https://www.walmart.com/ip/Golden-Delicious-Apple-Tree/123)",
  }], [], seen, 8);
  assert.deepEqual(candidates.map((item) => item.url), [
    "https://www.walmart.com/ip/Fresh-Golden-Delicious-Apple-Each/44391046?classType=REGULAR",
    "https://www.walmart.com/ip/Golden-Delicious-Apple-Tree/123",
  ]);
  assert.equal(candidates[0].title, "Fresh Golden Delicious Apple, Each, $0.89");
  assert.equal(candidates[0].parentUrl, "https://www.walmart.com/c/kp/golden-delicious");
  assert.equal(seen.has("https://www.walmart.com/c/kp/golden-delicious"), false);
});

test("source review accepts only known unique result indices", () => {
  const candidates = [
    { url: "https://www.walmart.com/ip/apple-tree", title: "Golden Delicious Apple Tree" },
    { url: "https://www.walmart.com/ip/fresh-apple", title: "Fresh Golden Delicious Apple" },
  ];
  assert.deepEqual(selectReviewedCandidates(candidates, { indices: [1] }), [candidates[1]]);
  assert.throws(() => selectReviewedCandidates(candidates, { indices: [2] }));
  assert.throws(() => selectReviewedCandidates(candidates, { indices: [1, 1] }));
});

test("a related product price cannot validate the requested apple", () => {
  const apple = { product_name: "Fresh Golden Delicious Apple, Each", price: 3.97 };
  const markdown = "# Fresh Golden Delicious Apple, Each\n" + "Description. ".repeat(90) +
    "Product 1 of 5: Granny Smith Apples, current price $3.97";
  assert.throws(() => verifyPriceEvidence(apple, markdown), /not supported/);
  assert.doesNotThrow(() => verifyPriceEvidence({ ...apple, price: 0.89 },
    "[Fresh Golden Delicious Apple, Each, $0.89](https://www.walmart.com/ip/apple)"));
  assert.doesNotThrow(() => verifyPriceEvidence({ price: 0.89 },
    "[Fresh Golden Delicious Apple, Each, $0.89](https://www.walmart.com/ip/apple)",
    "Fresh Golden Delicious Apple, Each, $0.89, 11.1 ¢/oz"));
  assert.equal(classifySourceError(new Error("Price was not supported by source text.")), "UNVERIFIED_PRICE");
});

test("Firecrawl errors are normalized without forwarding provider text", () => {
  assert.equal(classifySourceError(new Error("We apologize for the inconvenience but we do not support this site.")), "UNSUPPORTED_SITE");
  assert.equal(classifySourceError(new Error("Firecrawl returned no structured JSON object.")), "NO_STRUCTURED_JSON");
  assert.equal(classifySourceError(new Error("Firecrawl returned an incomplete record (1/8 fields).")), "SCHEMA_MISMATCH");
  assert.equal(classifySourceError(Object.assign(new Error("Forbidden"), { status: 403 })), "ACCESS_BLOCKED");
  assert.equal(classifySourceError(Object.assign(new Error("Source returned HTTP 401."), { status: 401 })), "ACCESS_BLOCKED");
  assert.equal(classifySourceError(Object.assign(new Error("No credits"), { status: 429 })), "RATE_LIMITED");
  assert.equal(classifySourceError(Object.assign(new Error("Payment required"), { status: 402 })), "CONFIG_OR_BILLING");
  assert.equal(classifySourceError(new Error("FIRECRAWL_API_KEY is required to run an API job.")), "CONFIG_OR_BILLING");
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
  assert.equal(RUN_LIMITS.searches, 6);
  assert.equal(RUN_LIMITS.plannedSearches, 5);
  assert.equal(RUN_LIMITS.scrapes, 12);
  assert.equal(RUN_LIMITS.candidates, 12);
  assert.equal(RUN_LIMITS.recoveryCalls, 1);
  assert.equal(canSearch(6, now), false);
  assert.equal(canScrape(4, 0, 0, now), true);
  assert.equal(canScrape(5, 0, 0, now), true);
  assert.equal(canScrape(12, 0, 0, now), false);
  assert.equal(canScrape(1, 5, 5, now), false);
  assert.equal(canRecover(1, 2, 0, 0, 2, 2, now), true);
  assert.equal(canRecover(1, 2, 0, 1, 0, 0, now), false);
  assert.equal(canRecover(1, 2, 1, 0, 2, 2, now), false);
  assert.equal(canRecover(1, 2, 0, 0, 5, 5, now), false);
  assert.equal(canRecover(1, 2, 0, 0, 0, 0, now - RUN_LIMITS.durationMs - 1), false);
});

test("search depth maps loose record targets to bounded paid calls", () => {
  assert.deepEqual(runLimitsForSearchDepth("focused"), { ...RUN_LIMITS, searches: 3, plannedSearches: 2, scrapes: 3, candidates: 3 });
  assert.deepEqual(runLimitsForSearchDepth("balanced"), { ...RUN_LIMITS, searches: 5, plannedSearches: 4, scrapes: 6, candidates: 6 });
  assert.deepEqual(runLimitsForSearchDepth("deep"), RUN_LIMITS);
});


test("planned discovery searches every requested subject within a fixed budget", () => {
  assert.deepEqual(plannedSearchQueries([" JavaScript MDN ", "HTML MDN", "CSS MDN", "HTML MDN", "extra query"]),
    ["JavaScript MDN", "HTML MDN", "CSS MDN", "extra query"]);
});


test("discovery gives each subject a source before trying fallbacks", () => {
  const batches = [
    { query: "JavaScript", candidates: [{ url: "https://mdn.test/js" }, { url: "https://mdn.test/js2" }, { url: "https://mdn.test/js3" }] },
    { query: "HTML", candidates: [{ url: "https://mdn.test/html" }] },
    { query: "CSS", candidates: [{ url: "https://mdn.test/css" }] },
  ];
  const ordered = prioritizeSearchBatches(batches, 5);
  assert.deepEqual(ordered.map((candidate) => candidate.plannedQuery), ["JavaScript", "HTML", "CSS", "JavaScript", "JavaScript"]);
  assert.deepEqual(missingPlannedQueries(batches.map((batch) => batch.query), new Set(["JavaScript"])), ["HTML", "CSS"]);
  assert.deepEqual(missingPlannedQueries(batches.map((batch) => batch.query), new Set(["JavaScript", "HTML", "CSS"])), []);
});

test("collection extraction keeps separate items from one page", () => {
  const schema = { course_code: { type: "string" as const }, course_title: { type: "string" as const } };
  const rows = normalizeCollectionData({ items: [
    { course_code: "ECE 105", course_title: "Classical Mechanics" },
    { course_code: "ECE 150", course_title: "Fundamentals of Programming" },
  ] }, schema, "https://example.edu/courses");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].course_code, "ECE 150");
  assert.equal(rows[0].source_url, "https://example.edu/courses");
});
test("collection search may retain a course list page", () => {
  const pages = filterCandidates([{ url: "https://example.edu/category/courses", title: "ECE 1A courses" }], [], new Set(), 5, true);
  assert.equal(pages.length, 1);
});
test("price evidence uses the planned item_name field", () => {
  assert.doesNotThrow(() => verifyPriceEvidence({ item_name: "Fresh grapes", price: 2.49 }, "# Fresh grapes\nPrice $2.49"));
  assert.throws(() => verifyPriceEvidence({ item_name: "Fresh grapes", price: 9.99 }, "# Fresh grapes\nPrice $2.49"), /not supported/);
});

test("product profile corroborates only the exact page and a single current price", () => {
  const url = "https://www.walmart.com/ip/Fresh-Grapes/123";
  const profile = { title: "Fresh Grapes", url, variants: [{ price: { amount: 2.49, currency: "USD" } }] };
  assert.equal(verifiedProductProfile(profile, url, { item_name: "Fresh Grapes", price: 2.49 })?.price, 2.49);
  assert.equal(verifiedProductProfile(profile, url, { item_name: "Fresh Grapes", price: 5.99 }), null);
  assert.equal(verifiedProductProfile(profile, "https://www.walmart.com/ip/Other/999", null), null);
  assert.equal(verifiedProductProfile({ ...profile, variants: [
    { price: { amount: 2.49 } }, { price: { amount: 3.99 } },
  ] }, url, null), null);
});
