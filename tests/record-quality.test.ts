import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePriceSource, validateRecordQuality } from "../src/lib/record-quality.ts";
import { validateSourceSuggestion } from "../src/lib/source-correction.ts";

const schema = { product_name: { type: "string" as const }, price: { type: "number" as const } };

test("a price request requires a real price even when other fields are filled", () => {
  assert.throws(() => validateRecordQuality({ request: "AirPods price on Amazon", schema,
    data: { product_name: "AirPods", price: null }, sourceUrl: "https://www.amazon.com/dp/B012345678" }), /Required price/);
});

test("Amazon price records require a product page and matching ASIN and variant", () => {
  const base = { request: "Galaxy Flip3 price on Amazon", schema,
    sourceUrl: "https://www.amazon.com/dp/B09TWSY6V4",
    sourceTitle: "Samsung Galaxy Z Flip3 5G, Green, Verizon, Renewed" };
  assert.throws(() => validateRecordQuality({ ...base, sourceUrl: "https://www.amazon.com/clp/abc",
    data: { product_name: "Galaxy Flip3", price: 228.44 } }), /product detail page/);
  assert.throws(() => validateRecordQuality({ ...base,
    data: { product_name: "Galaxy Flip3 Cream Unlocked Renewed", price: 228.44 } }), /variant/);
  assert.throws(() => validateRecordQuality({ ...base, canonicalUrl: "https://www.amazon.com/dp/B012345678",
    data: { product_name: "Galaxy Flip3 Green Verizon Renewed", price: 228.44 } }), /ASIN/);
  assert.doesNotThrow(() => validateRecordQuality({ ...base,
    data: { product_name: "Galaxy Flip3 Green Verizon Renewed", price: 228.44 } }));
});

test("Amazon category price sources fail before scraping", () => {
  assert.throws(() => validatePriceSource("AirPods price on Amazon", schema, "https://www.amazon.com/clp/airpods"), /product detail page/);
  assert.doesNotThrow(() => validatePriceSource("AirPods price on Amazon", schema, "https://www.amazon.com/dp/B012345678"));
});

test("a source correction must differ from the original request", () => {
  assert.equal(validateSourceSuggestion("Fresco Canada", "Find fresh apples at Fresco Canada"), null);
  assert.equal(validateSourceSuggestion("FreshCo Canada", "Find fresh apples at Fresco Canada"), "FreshCo Canada");
});
