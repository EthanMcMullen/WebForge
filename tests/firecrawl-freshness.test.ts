import assert from "node:assert/strict";
import test from "node:test";
import { Firecrawl } from "firecrawl";
import { firecrawlProvider } from "../src/lib/providers/firecrawl.ts";
import { withVisionFallback } from "../src/lib/providers/vision.ts";

test("record and collection scrapes bypass indexed page content", async () => {
  const originalKey = process.env.FIRECRAWL_API_KEY;
  const originalScrape = Object.getOwnPropertyDescriptor(Firecrawl.prototype, "scrape");
  const options: Array<{ maxAge?: number }> = [];
  process.env.FIRECRAWL_API_KEY = "test-key";
  Object.defineProperty(Firecrawl.prototype, "scrape", {
    configurable: true,
    value: async (_url: string, scrapeOptions: { maxAge?: number }) => {
      options.push(scrapeOptions);
      return { json: { title: "Current item", items: [{ title: "Current item" }] } };
    },
  });
  try {
    const schema = { title: { type: "string" as const }, source_url: { type: "string" as const } };
    await firecrawlProvider.extract("https://shop.example/item", schema);
    await firecrawlProvider.extractCollection!("https://shop.example/list", schema, "Current items");
    assert.deepEqual(options.map((option) => option.maxAge), [0, 0]);
  } finally {
    if (originalScrape) Object.defineProperty(Firecrawl.prototype, "scrape", originalScrape);
    if (originalKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalKey;
  }
});

test("vision screenshot also bypasses indexed page content", async () => {
  const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
  const originalOpenaiKey = process.env.OPENAI_API_KEY;
  const originalFlag = process.env.WEBFORGE_VISION_FALLBACK;
  const originalScrape = Object.getOwnPropertyDescriptor(Firecrawl.prototype, "scrape");
  const options: Array<{ maxAge?: number; proxy?: string }> = [];
  process.env.FIRECRAWL_API_KEY = "test-key";
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.WEBFORGE_VISION_FALLBACK;
  Object.defineProperty(Firecrawl.prototype, "scrape", {
    configurable: true,
    value: async (_url: string, scrapeOptions: { maxAge?: number; proxy?: string }) => {
      options.push(scrapeOptions);
      return { screenshot: "https://shots.example/current.png", markdown: "Current item" };
    },
  });
  try {
    const provider = withVisionFallback({
      discover: async () => [],
      extract: async () => { throw new Error("Firecrawl returned no usable fields."); },
    }, { readImage: async () => ({ data: { title: "Current item" }, identity: "Current item" }) });
    const result = await provider.extract("https://shop.example/item", { title: { type: "string" } });
    assert.equal(result.viaVision, true);
    assert.deepEqual(options.map((option) => [option.maxAge, option.proxy]), [[0, "stealth"]]);
  } finally {
    if (originalScrape) Object.defineProperty(Firecrawl.prototype, "scrape", originalScrape);
    if (originalFirecrawlKey === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
    if (originalOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenaiKey;
    if (originalFlag === undefined) delete process.env.WEBFORGE_VISION_FALLBACK;
    else process.env.WEBFORGE_VISION_FALLBACK = originalFlag;
  }
});
