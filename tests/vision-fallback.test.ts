import assert from "node:assert/strict";
import test from "node:test";
import { RUN_LIMITS } from "../src/lib/run-budget.ts";
import { classifySourceError } from "../src/lib/source-support.ts";
import type { ApiRecordSchema } from "../src/lib/types.ts";
import { isVisionFallbackEligible, verifyVisionPriceEvidence, visionFallbackEnabled, visionModel } from "../src/lib/vision-fallback.ts";
import { withVisionFallback } from "../src/lib/providers/vision.ts";
import type { ExtractionProvider } from "../src/lib/providers/firecrawl.ts";

const schema: ApiRecordSchema = {
  product: { type: "string", description: "Product name" },
  source_url: { type: "string", description: "Provenance" },
};

const originalKey = process.env.OPENAI_API_KEY;
const originalFlag = process.env.WEBFORGE_VISION_FALLBACK;
const originalModel = process.env.OPENAI_VISION_MODEL;
function withKey() {
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.WEBFORGE_VISION_FALLBACK;
}
function restoreEnv() {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  if (originalFlag === undefined) delete process.env.WEBFORGE_VISION_FALLBACK;
  else process.env.WEBFORGE_VISION_FALLBACK = originalFlag;
  if (originalModel === undefined) delete process.env.OPENAI_VISION_MODEL;
  else process.env.OPENAI_VISION_MODEL = originalModel;
}

function baseProvider(extract: ExtractionProvider["extract"]): ExtractionProvider {
  return { discover: async () => [], extract };
}

const visionData = { product: "Entry espresso machine", source_url: "https://shop.example/grinder" };
const visionDeps = {
  capture: async () => ({ screenshotUrl: "https://shots.example/1.png", markdown: "Entry espresso machine" }),
  readImage: async () => ({ data: { ...visionData }, identity: "Entry espresso machine" }),
};

test("successful scrape never triggers the vision fallback", async () => {
  withKey();
  try {
    let captures = 0;
    const provider = withVisionFallback(baseProvider(async () => ({
      data: { ...visionData }, identity: "Entry espresso machine",
    })), { capture: async () => { captures++; return { screenshotUrl: "x" }; }, readImage: visionDeps.readImage });
    const result = await provider.extract("https://shop.example/grinder", schema);
    assert.equal(result.data.product, "Entry espresso machine");
    assert.equal(result.viaVision, undefined);
    assert.equal(captures, 0);
  } finally { restoreEnv(); }
});

test("empty scrape output falls back to the screenshot reader", async () => {
  withKey();
  try {
    let attempts = 0;
    const provider = withVisionFallback(
      baseProvider(async () => { throw new Error("Firecrawl returned no usable fields."); }),
      { ...visionDeps, requestAttempt: () => { attempts++; return true; } },
    );
    const result = await provider.extract("https://shop.example/grinder", schema, undefined, "Track espresso prices");
    assert.equal(result.data.product, "Entry espresso machine");
    assert.equal(result.data.source_url, "https://shop.example/grinder");
    assert.equal(result.viaVision, true);
    assert.equal(attempts, 1);
  } finally { restoreEnv(); }
});

test("a missing price on a non-Amazon product page tries vision", async () => {
  withKey();
  try {
    let captures = 0;
    const pricedSchema: ApiRecordSchema = {
      product_name: { type: "string" }, price: { type: "number" }, source_url: { type: "string" },
    };
    const url = "https://shop.example/products/headphones-3";
    const provider = withVisionFallback(baseProvider(async () => ({
      data: { product_name: "Headphones 3", price: null, source_url: url }, identity: "Headphones 3",
    })), {
      capture: async () => { captures++; return { screenshotUrl: "https://shots.example/price.png" }; },
      readImage: async () => ({ data: { product_name: "Headphones 3", price: 49.99, source_url: url }, identity: "Headphones 3" }),
    });
    const result = await provider.extract(url, pricedSchema);
    assert.equal(result.data.price, 49.99);
    assert.equal(result.viaVision, true);
    assert.equal(captures, 1);
  } finally { restoreEnv(); }
});

test("unverified price retries with vision, but an Amazon listing never does", async () => {
  withKey();
  try {
    let captures = 0;
    const pricedSchema: ApiRecordSchema = { price: { type: "number" }, source_url: { type: "string" } };
    const provider = withVisionFallback(baseProvider(async () => {
      throw new Error("Price was not supported by source text.");
    }), {
      capture: async () => { captures++; return { screenshotUrl: "https://shots.example/price.png" }; },
      readImage: async () => ({ data: { price: 49.99 }, identity: "Headphones 3" }),
    });
    assert.equal((await provider.extract("https://shop.example/item/3", pricedSchema)).viaVision, true);
    await assert.rejects(provider.extract("https://www.amazon.com/airpods-3/s?k=airpods+3", pricedSchema), /not supported/);
    assert.equal(captures, 1);
  } finally { restoreEnv(); }
});

test("a screenshot without the requested price does not count as recovery", async () => {
  withKey();
  try {
    const schemaWithPrice: ApiRecordSchema = { product_name: { type: "string" }, price: { type: "number" } };
    const provider = withVisionFallback(baseProvider(async () => ({
      data: { product_name: "Headphones 3", price: null }, identity: "Headphones 3",
    })), {
      capture: async () => ({ screenshotUrl: "https://shots.example/price.png" }),
      readImage: async () => ({ data: { product_name: "Headphones 3", price: null }, identity: "Headphones 3" }),
    });
    await assert.rejects(provider.extract("https://shop.example/products/headphones-3", schemaWithPrice), /Required price is missing/);
  } finally { restoreEnv(); }
});

test("visual price evidence must match the extracted item and amount", () => {
  const data = { product_name: "Headphones 3", price: 49.99 };
  assert.doesNotThrow(() => verifyVisionPriceEvidence(data, undefined, "Headphones 3 current price $49.99"));
  assert.throws(() => verifyVisionPriceEvidence(data, undefined, "Headphones 2 current price $49.99"), /not supported/);
  assert.throws(() => verifyVisionPriceEvidence(data, undefined, "Headphones 3 current price $59.99"), /not supported/);
  assert.throws(() => verifyVisionPriceEvidence(data, undefined, null), /not supported/);
});

test("fatal and validation failures never trigger the vision fallback", async () => {
  withKey();
  try {
    for (const message of [
      "Firecrawl search stopped: rate limited.",
      "Record does not match the request.",
      "Price was not supported by source text.",
      "Source returned HTTP 403.",
    ]) {
      let captures = 0;
      const provider = withVisionFallback(
        baseProvider(async () => { throw new Error(message); }),
        { capture: async () => { captures++; return { screenshotUrl: "x" }; }, readImage: visionDeps.readImage },
      );
      await assert.rejects(
        provider.extract("https://shop.example/item", schema),
        (error: unknown) => (error as Error).message === message,
      );
      assert.equal(captures, 0);
    }
  } finally { restoreEnv(); }
});

test("vision fallback stays off without a key, with the opt-out flag, or on an empty budget", async () => {
  const failing = baseProvider(async () => { throw new Error("Firecrawl returned no usable fields."); });
  try {
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(withVisionFallback(failing, visionDeps).extract("https://shop.example/a", schema), /no usable fields/);

    process.env.OPENAI_API_KEY = "test-key";
    process.env.WEBFORGE_VISION_FALLBACK = "0";
    await assert.rejects(withVisionFallback(failing, visionDeps).extract("https://shop.example/b", schema), /no usable fields/);

    delete process.env.WEBFORGE_VISION_FALLBACK;
    await assert.rejects(
      withVisionFallback(failing, { ...visionDeps, requestAttempt: () => false }).extract("https://shop.example/c", schema),
      /no usable fields/,
    );
  } finally { restoreEnv(); }
});

test("a failed vision read keeps the original scrape error unless vision fails fatally", async () => {
  withKey();
  try {
    const failing = baseProvider(async () => { throw new Error("Firecrawl returned no usable fields."); });
    const softVision = withVisionFallback(failing, {
      ...visionDeps,
      readImage: async () => { throw new Error("Vision fallback returned no data."); },
    });
    await assert.rejects(softVision.extract("https://shop.example/a", schema), /Firecrawl returned no usable fields/);

    const fatalVision = withVisionFallback(failing, {
      ...visionDeps,
      readImage: async () => { throw Object.assign(new Error("Unauthorized."), { status: 401 }); },
    });
    await assert.rejects(fatalVision.extract("https://shop.example/b", schema), /Unauthorized/);
  } finally { restoreEnv(); }
});

test("vision output with no usable fields keeps the original scrape error", async () => {
  withKey();
  try {
    const provider = withVisionFallback(
      baseProvider(async () => { throw new Error("Firecrawl returned no usable fields."); }),
      { ...visionDeps, readImage: async () => ({ data: { product: null, source_url: "https://shop.example/a" }, identity: null }) },
    );
    await assert.rejects(provider.extract("https://shop.example/a", schema), /Firecrawl returned no usable fields/);
  } finally { restoreEnv(); }
});

test("blocked pages are worth one screenshot: bot walls may render visually", async () => {
  withKey();
  try {
    const blocked = Object.assign(new Error("Access denied."), { status: 403 });
    assert.equal(isVisionFallbackEligible(blocked), true);
    let captures = 0;
    const provider = withVisionFallback(
      baseProvider(async () => { throw blocked; }),
      { capture: async () => { captures++; return { screenshotUrl: "https://shots.example/1.png" }; }, readImage: visionDeps.readImage },
    );
    const result = await provider.extract("https://www.amazon.com/dp/B0DEXAMPLE1", schema, undefined, "iPhone 17 price on Amazon");
    assert.equal(result.data.product, "Entry espresso machine");
    assert.equal(result.viaVision, true);
    assert.equal(captures, 1);
  } finally { restoreEnv(); }
});

test("vision eligibility covers extraction failures and bot blocks, not validation gates", () => {
  assert.equal(isVisionFallbackEligible(new Error("Firecrawl returned no usable fields.")), true);
  assert.equal(isVisionFallbackEligible(new Error("Firecrawl returned an incomplete record (1/4 fields).")), true);
  assert.equal(isVisionFallbackEligible(new Error("socket hang up")), true);
  assert.equal(isVisionFallbackEligible(new Error("Source returned HTTP 403.")), false);
  assert.equal(isVisionFallbackEligible(new Error("Record does not match the request.")), false);
  assert.equal(isVisionFallbackEligible(new Error("Price was not supported by source text.")), false);
  assert.equal(isVisionFallbackEligible(Object.assign(new Error("Too many requests."), { status: 429 })), false);
});

test("vision errors classify into the existing failure codes", () => {
  assert.equal(classifySourceError(new Error("Vision fallback returned no usable fields.")), "NO_STRUCTURED_JSON");
  assert.equal(classifySourceError(new Error("Vision fallback returned an incomplete record (1/4 fields).")), "SCHEMA_MISMATCH");
  assert.equal(classifySourceError(new Error("Vision fallback price was not supported by source text.")), "UNVERIFIED_PRICE");
});

test("vision fallback policy honors the key, opt-out flag, model override, and run budget", () => {
  try {
    delete process.env.OPENAI_API_KEY;
    assert.equal(visionFallbackEnabled(), false);
    process.env.OPENAI_API_KEY = "test-key";
    assert.equal(visionFallbackEnabled(), true);
    process.env.WEBFORGE_VISION_FALLBACK = "off";
    assert.equal(visionFallbackEnabled(), false);
    delete process.env.WEBFORGE_VISION_FALLBACK;
    delete process.env.OPENAI_VISION_MODEL;
    assert.equal(visionModel(), "gpt-4.1-mini");
    process.env.OPENAI_VISION_MODEL = "gpt-4.1";
    assert.equal(visionModel(), "gpt-4.1");
    assert.equal(RUN_LIMITS.visionFallbacks, 2);
  } finally { restoreEnv(); }
});
