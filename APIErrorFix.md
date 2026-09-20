# API Error Fix: reliable product prices without wrong matches

## Status and scope

Plan only. This document addresses the failed **Grapes#2** request: “Make an API to track the price of grapes at Walmart.” It does not mark that job resolved. The planner improvements in commit `6e9c66c` address invented searches and collection planning; this is a separate extraction/recovery failure.

The run found real Walmart product URLs, made 3 searches and 4 scrapes, used its one recovery decision, and saved 0 records. Two product-page attempts were reported as `unverified price`. The UI ended with “Recovery found no better public source query,” which hides the useful diagnosis.

A [failed grape product page](https://www.walmart.com/ip/Fresh-Green-Seedless-Grapes-2-25-lbs-Bag-Est/44390943) shows prices for *similar items* in public page text while the main product has no visible price there. This observation does not prove what Firecrawl saw in its exact run; raw per-source evidence was not persisted. Never accept a nearby recommendation price as the main product's price.

## Code findings

- `src/lib/providers/firecrawl.ts` requests JSON plus Markdown for numeric prices and calls `verifyPriceEvidence` before saving.
- `src/lib/extraction.ts` verifies an exact currency amount near an exact item name. It recognizes `product_name`, but this job's schema uses `item_name`; it can fall back to a search-result title that differs from the page title. This can reject a valid price. The proximity window can also include unrelated product cards, so loosening it alone is unsafe.
- `src/lib/pipeline.ts` only tries a listing-page fallback for `UNVERIFIED_PRICE` when the candidate already has `parentUrl`. Direct `/ip/` search results have no such parent, so they cannot use that path.
- `src/lib/source-support.ts` can discover individual product links inside category snippets, but currently filters category pages from ordinary candidates.
- Walmart may require a delivery/store location before displaying a product price. This is an inference from the public page's “Pickup or delivery?” prompt and missing main-product price, not a verified rule for every Walmart page. Firecrawl supports country/language location settings; country alone is not a store or ZIP selection. See [Firecrawl scrape location options](https://docs.firecrawl.dev/features/scrape#location-and-language).

## Desired behavior

For each saved price, retain evidence that the **current price belongs to the exact item and variant represented by the record**. When no matching public price is available, stop with a useful reason and keep any previously saved record. Do not silently use a recommendation, former price, unit price, or a different grape variety/size.

## Implementation steps

### 1. Persist bounded, safe source diagnostics

Add a small per-source attempt record to each run: normalized URL, planned query, phase (`search`, `scrape`, `price_check`, `fallback`, `record_review`), failure code, short safe explanation, and whether the page had a candidate name and price. Save the page's HTTP status, canonical URL, and title when present. Do **not** persist full page text, raw model output, credentials, or arbitrary provider error prose. Expose these attempts in `/api/jobs/:id/runs` and the run detail UI. Preserve the current aggregate counters.

This makes it possible to distinguish “no main-product price in source text” from “our name/price matcher missed visible evidence” after a run ends.

### 2. Correct price verification before adding retries

Update `verifyPriceEvidence` to get the item identity from the planned identity field (`item_name`, `product_name`, `name`, etc.), rather than only `product_name` or a search title. Normalize harmless punctuation and whitespace differences. Recognize normal currency displays such as `$3.76` and Walmart's split `$3 76`, but distinguish current price from “Was $4.21” and `$1.67/lb`.

Match price within a clearly delimited product block or a structured product/variant object. Prefer exact product URL or stable product ID when available. If identity or block boundaries cannot be established, reject the price. Keep the existing wrong-item regression; never replace it with a simple “price appears anywhere on page” check.

### 3. Evaluate Firecrawl's product format on one known case

Firecrawl documents a [product format](https://docs.firecrawl.dev/features/scrape#extract-product-data) with product title, variants, and prices. Test it against one failed Walmart `/ip/` URL and one known working product URL. Confirm whether it exposes the main product price when JSON+Markdown does not, and compare the returned product/variant identity against the requested URL and title. Use it as a product-specific extractor or bounded fallback only if the evidence is actually better. A product object with no price, or with a mismatched variant, is still a failure. Check credits and latency before choosing whether to request it with the first scrape or only after a failed price check.

### 4. Add one bounded exact-product listing fallback

When a product-page price is unverified, first use an existing `parentUrl` if present. Otherwise, if the run has budget, make **at most one** targeted discovery for a listing or category card for that product; never search for an unrelated substitute. Only accept a card when its URL/product ID identifies the same product, its name/variant matches, and its current price is visibly tied to that card. Store the listing page as the price's provenance and the product URL as the item identity/source link. Do not retry the same URL within the run.

Count every fallback search and scrape against the selected Focused/Balanced/Deep limits and four-minute deadline. Keep the existing one-recovery-decision ceiling; the price fallback must not start a second unbounded recovery loop. If no budget remains, stop with `PRICE_NOT_VERIFIABLE` and explain the exhausted budget.

### 5. Handle location-dependent prices explicitly

Add optional region context to a price job (country first; store/ZIP only if an approved data path can actually use it). Persist it with the job and include it in the API record or metadata so a price is never presented as universal. Do not invent a store location. A country-level Firecrawl location setting may help page rendering, but must be tested and must not be represented as a store-specific price. If Walmart still withholds the exact price, report `PRICE_REQUIRES_LOCATION_OR_LOGIN` or `PRICE_NOT_PUBLIC` instead of searching indefinitely.

### 6. Make the outcome useful

If no records are saved, lead with the dominant reason: e.g., “Walmart did not expose a verifiable price for these grape products.” Show the failed product URLs and whether the price came only from related items. Put the generic recovery message second. If some records succeed, return partial data with the exact failed items. A refresh must keep prior verified records and mark them stale rather than replacing them with an unverified value.

## Tests and verification

1. Unit fixture: `item_name` differs slightly from the page heading but the current price appears in the same product block; accept it.
2. Unit fixture: main grape product has no price and a recommended grape product does; reject it, even when the recommendation has the same amount the LLM returned.
3. Unit fixture: former price and per-pound price are present but no current item price; reject them.
4. Unit fixture: exact product/variant card on a listing page has a current price and the same URL/product ID; accept it with listing-page provenance. A different size or variety must fail.
5. Mocked pipeline: direct `/ip/` result with `UNVERIFIED_PRICE` can attempt one fallback when budget remains; repeated URL, no match, cancelled run, timeout, and exhausted budget make no extra paid calls.
6. Mocked refresh: a failed price update preserves the last verified record and reports staleness.
7. Controlled live checks: one previously failing grape page and one known working product page. Inspect the saved JSON, exact evidence source, status, and Firecrawl dashboard credits. Do not run a broad scrape suite just to test the fallback.
8. Run `npm test`, `npm run lint`, and `npm run build` after implementation.

## Acceptance criteria

- The grape request either yields a grape product with a verifiable, item-matched current price **or** clearly says that Walmart did not expose one. It must never save a similar product's price.
- The run UI identifies the failing phase and URL without exposing raw page content.
- At most one targeted price fallback is attempted per product, and all calls fit the existing per-run limits. No daily credit cap is added.
- The previous Walmart Golden Delicious apple correctness regression still passes.
- The original `Grapes#2` job may need a new run after deployment; its prior failed run remains in history.

## Provider references

Firecrawl's [Scrape documentation](https://docs.firecrawl.dev/features/scrape) describes Markdown, JSON, product output, location settings, and separate API/page status. Its [Search documentation](https://docs.firecrawl.dev/features/search) describes result metadata and current search cost behavior. Check the live dashboard for actual charges.
