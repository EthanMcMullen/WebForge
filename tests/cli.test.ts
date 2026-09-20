import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
// The executable stays plain ESM so npm can install it directly as a bin command.
// @ts-expect-error The CLI intentionally has no separate declaration file.
import { normalizeBaseUrl, parseCliArgs, parseFieldSelection, parseRefreshInterval } from "../scripts/cli.mjs";

test("CLI parses repeatable URLs and boolean switches", () => {
  assert.deepEqual(parseCliArgs(["create", "--depth", "focused", "--url", "https://one.test", "--url=https://two.test", "--wait"]), {
    command: "create",
    options: { _: [], depth: "focused", url: ["https://one.test", "https://two.test"], wait: true },
  });
});

test("CLI field selection accepts names and one-based numbers", () => {
  const available = ["course_name", "professor_name", "professor_rating"];
  assert.deepEqual(parseFieldSelection("1,professor_rating,1", available), ["course_name", "professor_rating"]);
  assert.throws(() => parseFieldSelection("4", available), /Choose fields/);
});

test("CLI base URL normalization permits only HTTP services", () => {
  assert.equal(normalizeBaseUrl("http://localhost:3000/"), "http://localhost:3000");
  assert.throws(() => normalizeBaseUrl("file:///tmp/webforge"), /HTTP or HTTPS/);
});

test("CLI validates automatic refresh intervals", () => {
  assert.equal(parseRefreshInterval("60"), 60);
  assert.throws(() => parseRefreshInterval("14"), /15 to 525600/);
  assert.throws(() => parseRefreshInterval("hourly"), /whole number/);
});

test("downloadable CLI stays synchronized with the installed command", () => {
  assert.equal(readFileSync("public/downloads/webforge-cli.mjs", "utf8"), readFileSync("scripts/cli.mjs", "utf8"));
});
