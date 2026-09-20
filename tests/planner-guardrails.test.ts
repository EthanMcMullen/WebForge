import assert from "node:assert/strict";
import test from "node:test";
import { invalidPlanReason, recordScopeForRequest } from "../src/lib/planner-guardrails.ts";

test("plural ECE and espresso requests are collections even if the model says single", () => {
  assert.equal(recordScopeForRequest("Make an API for all the classes in ECE first year university of waterloo 1A courses", "single"), "collection");
  assert.equal(recordScopeForRequest("Find and document different espresso machines and their prices", "single"), "collection");
  assert.equal(recordScopeForRequest("Get all specifications for the iPhone 16 Pro", "single"), "single");
});

test("specific single-item requests retain their plan scope", () => {
  assert.equal(recordScopeForRequest("iPhone 16 Pro display size and benchmark", "single"), "single");
});

test("placeholder and repeated searches are rejected before Firecrawl", () => {
  assert.match(invalidPlanReason({ searchQueries: ["site:manualsonline.com espresso machine model XYZ specifications"] }) || "", /placeholder/);
  assert.match(invalidPlanReason({ searchQueries: ["espresso machine prices", "ESPRESSO MACHINE PRICES"] }) || "", /repeat/);
  assert.equal(invalidPlanReason({ searchQueries: ["Waterloo ECE first year 1A courses site:uwaterloo.ca"] }), null);
});
