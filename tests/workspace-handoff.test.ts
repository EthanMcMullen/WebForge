import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkspaceHandoff } from "../src/lib/workspace-handoff.ts";

test("landing-page input becomes a complete New API workspace handoff", () => {
  const handoff = parseWorkspaceHandoff("?request=List+public+courses&name=Course+API&strategy=provided_urls&combine=1&sources=https%3A%2F%2Fexample.com&refresh=30m");
  assert.deepEqual(handoff, {
    request: "List public courses",
    name: "Course API",
    strategy: "provided_urls",
    combine: true,
    sources: "https://example.com",
    refresh: "30",
  });
});

test("workspace handoff ignores navigation without an API request", () => {
  assert.equal(parseWorkspaceHandoff(""), null);
  assert.equal(parseWorkspaceHandoff("?request=++"), null);
});
