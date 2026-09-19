import assert from "node:assert/strict";
import test from "node:test";
import { demoFields, demoRecords } from "../src/lib/demo.ts";
import { cleanSourceUrls, normalizePublicUrl } from "../src/lib/validation.ts";
import type { Dataset } from "../src/lib/types.ts";

test("only public web URLs are accepted as sources", () => {
  assert.equal(normalizePublicUrl("http://localhost:3000/private"), null);
  assert.equal(normalizePublicUrl("http://127.0.0.1/private"), null);
  assert.equal(normalizePublicUrl("https://user:pass@example.com/item"), null);
  assert.equal(normalizePublicUrl("file:///etc/passwd"), null);
  assert.deepEqual(cleanSourceUrls(["https://example.com/item#details", "https://example.com/item"]), ["https://example.com/item"]);
});

test("demo records are labeled sample and never claim real verification", () => {
  const dataset: Dataset = {
    id: "dataset-test", name: "Laptop demo", prompt: "Track laptops", mode: "demo",
    status: "ready", fields: demoFields, sourceUrls: [], error: null,
    createdAt: "2026-09-19T00:00:00Z", updatedAt: "2026-09-19T00:00:00Z",
  };
  const records = demoRecords(dataset);
  assert.equal(records.length, 3);
  assert.equal(records[0].fieldStatus.name, "sample");
  assert.equal(records[2].fieldStatus.usb_c, "unknown");
  assert.ok(records.every((record) => record.evidence.every((item) => item.kind === "demo")));
});
