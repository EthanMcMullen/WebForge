import type { ApiRecordData, ApiRecordSchema } from "./types.ts";

const AMAZON_PRODUCT_PATH = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i;
const VARIANTS = [
  ["black", "white", "green", "blue", "red", "pink", "purple", "cream", "silver", "gold", "gray", "grey", "graphite"],
  ["verizon", "unlocked", "at&t", "t-mobile", "sprint"],
  ["renewed", "refurbished", "new", "used"],
];

function words(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9&+]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

export function validatePriceSource(request: string, schema: ApiRecordSchema, sourceUrl: string): void {
  if (!schema.price) return;
  const url = new URL(sourceUrl);
  const host = url.hostname.toLowerCase();
  if ((host === "amazon.com" || host.endsWith(".amazon.com") || /^amazon\.[a-z.]+$/.test(host) || /^www\.amazon\.[a-z.]+$/.test(host)) &&
      !AMAZON_PRODUCT_PATH.test(url.pathname)) {
    throw new Error("Amazon price needs a product detail page.");
  }
}

export function validateRecordQuality(input: {
  request: string;
  schema: ApiRecordSchema;
  data: ApiRecordData;
  sourceUrl: string;
  sourceTitle?: string | null;
  canonicalUrl?: string | null;
  allowMissingPrice?: boolean;
}): void {
  const { request, schema, data, sourceUrl, sourceTitle, canonicalUrl, allowMissingPrice } = input;
  validatePriceSource(request, schema, sourceUrl);
  if (schema.price && !allowMissingPrice && (typeof data.price !== "number" || !Number.isFinite(data.price))) {
    throw new Error("Required price is missing from the record.");
  }
  const host = new URL(sourceUrl).hostname.toLowerCase();
  if (host !== "amazon.com" && !host.endsWith(".amazon.com") && !/^amazon\.[a-z.]+$/.test(host) && !/^www\.amazon\.[a-z.]+$/.test(host)) return;
  if (!schema.price) return;
  const requestedAsin = new URL(sourceUrl).pathname.match(AMAZON_PRODUCT_PATH)?.[1]?.toUpperCase();
  if (!requestedAsin) throw new Error("Amazon price needs a product detail page.");
  if (canonicalUrl) {
    let canonicalAsin: string | undefined;
    try { canonicalAsin = new URL(canonicalUrl).pathname.match(AMAZON_PRODUCT_PATH)?.[1]?.toUpperCase(); }
    catch { /* No usable canonical URL was supplied. */ }
    if (canonicalAsin && canonicalAsin !== requestedAsin) throw new Error("Amazon product ASIN does not match the source page.");
  }
  if (typeof data.asin === "string" && data.asin.toUpperCase() !== requestedAsin) {
    throw new Error("Amazon product ASIN does not match the source page.");
  }
  if (!sourceTitle) return;
  const titleWords = words(sourceTitle);
  const recordWords = words(Object.entries(data)
    .filter(([key, value]) => key !== "source_url" && key !== "description" && typeof value === "string")
    .map(([, value]) => value).join(" "));
  for (const group of VARIANTS) {
    const pageVariants = group.filter((variant) => titleWords.includes(` ${variant} `));
    const recordVariants = group.filter((variant) => recordWords.includes(` ${variant} `));
    if (pageVariants.length && recordVariants.length && !recordVariants.some((variant) => pageVariants.includes(variant))) {
      throw new Error("Amazon product variant does not match the source page.");
    }
  }
}
