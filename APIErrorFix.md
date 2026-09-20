# API Error Fix: make WebForge runs reliably useful

## Goal

Fix the recurring pattern where a reasonable request spends OpenAI and Firecrawl calls yet yields zero or one unusable record, an unexplained partial result, or the wrong record shape. This plan applies to **all API jobs**, including products, course lists, documentation, and single entities. Grapes are one regression case, not the scope of the fix.

“Works” means WebForge either returns records that match the user's requested entities and fields **or** gives a precise, actionable reason why the public source cannot supply them. It must never invent a value merely to display Ready.

## What the current jobs show

| Request | Observed failure | Likely failure layer |
| --- | --- | --- |
| Different espresso machines and prices | Invented `model XYZ` searches; combined into one record | Planner and record-scope selection |
| All Waterloo ECE 1A classes | One combined course record; extra professor/location fields; several pages returned no JSON | Planner, collection extraction, source choice |
| ECE courses with prerequisites and ratings | One course record; ratings/professor unavailable from selected pages | Cross-source identity, source availability, collection extraction |
| Walmart grape prices | Real product pages found, but no item-matched public price was verified | Price evidence and bounded fallback |
| Earlier MDN JavaScript/HTML/CSS example | Three useful records were saved | Preserve this working path as a control case |

The grape run made 3 searches and 4 scrapes, used one recovery decision, and saved none. The ECE run made 4 searches and 5 scrapes but saved one course. The espresso run saved one machine after searching for a fictional placeholder. These are **different failure modes**; adding more retries to all of them would waste credits.

## Current code paths to audit

- `src/lib/planner.ts`: schema, search queries, and single-versus-collection scope. Commit `6e9c66c` improves this for **new** jobs, but existing jobs keep their saved plans on refresh.
- `src/lib/source-review.ts` and `src/lib/source-support.ts`: candidate filtering may reject a useful list or product card before scrape.
- `src/lib/providers/firecrawl.ts`: Firecrawl search, JSON+Markdown extraction, and price evidence. Recent vision fallback handles certain content failures, but not every rejected price or irrelevant record.
- `src/lib/extraction.ts` and `src/lib/record-quality.ts`: type, sparsity, identity, and price checks may reject valid values or allow nearby wrong-item evidence.
- `src/lib/record-review.ts`: a second LLM relevance decision can reject a useful extracted page.
- `src/lib/pipeline.ts` and `src/lib/run-budget.ts`: one-record-per-page assumption, combined-record behavior, recovery rules, call ceilings, and final status presentation.
- Worker/API/UI: queued jobs need a running worker; the UI currently compresses distinct causes into generic Failed or Partial data messages.

## Implementation order

### 1. Capture enough evidence to find the actual failing stage

Persist a bounded attempt summary for every source: planned query, normalized URL, stage (`candidate_filter`, `source_review`, `scrape`, `json_normalization`, `quality_check`, `record_review`, `save`), outcome code, safe explanation, source title/canonical URL/status, and which requested fields were present or missing. Record decisions **before** rejected candidates disappear. Do not persist full page text, raw model output, API keys, or arbitrary external error prose.

Expose an expanded run detail via `/api/jobs/:id/runs` and a simple UI view: “5 discovered → 3 selected → 2 scraped → 1 saved,” with each rejection reason. Track worker heartbeat/availability so Queued can say “worker offline” instead of appearing to hang. Keep aggregate counters but make `skipped` distinguish filtering, budget drops, and actual scrape failures.

### 2. Reproduce and locate regressions before loosening rules

Create sanitized fixtures for the five requests above, including the search results, selected URLs, Firecrawl response *shape*, and expected records. Use mocked provider responses so repeated tests cost no credits. Compare those fixtures against the current pipeline and the last known good commits to identify which gate first changed the result. Do not globally remove source or price checks: the old Walmart apple recommendation price was a real wrong-data bug.

Build a small decision table: a rejected candidate/record should have a stable reason code, whether that reason is correct, and the expected fallback. Fix a false rejection at its own stage. Keep one controlled live run per affected provider path after mocks pass.

### 3. Enforce the plan contract before paid discovery

For **new** jobs, the planner must state whether one record is one entity or one member of a collection. Collection requests must not become combined records. Only add requested fields plus identity and units/currency needed to interpret values. Reject fictional placeholder queries before Firecrawl. Show fields **and planned searches** before Build API. The first part is already implemented in `6e9c66c`; test it end to end and fill remaining gaps rather than treating prompt wording alone as proof.

If an existing job has a bad saved plan, Refresh must not silently rerun it forever. Provide an explicit **Replan / create corrected copy** action that shows the new schema, queries, and cost scope before running. Preserve old records and run history.

### 4. Separate collection discovery from single-record extraction

For requests such as “all ECE 1A classes,” first find an authoritative list and enumerate its member identities (course codes). Then extract one record per identified member, possibly using the same source page for multiple records or following individual detail pages. Preserve the list page as membership evidence. Never merge different members into one record. Use a bounded item count and report “N of M identified items saved,” naming the missing items.

For open-ended product collections, discover actual product URLs/names first, then extract one record per product. A search query should not invent a representative model. De-duplicate by canonical URL or stable product ID. Retain the existing single-item combined-source path for *one exact entity* with facts spread across pages.

### 5. Use extraction fallbacks matched to the failure

- **No structured JSON / malformed JSON:** Use the existing bounded vision fallback or one alternate format on the same page when eligible. Do not use vision for a billing error, unsupported site, or a relevance rejection. Keep JSON shape validation.
- **Requested price not verified:** First correct `verifyPriceEvidence` so it uses the planned identity field (`item_name`, `product_name`, etc.) and product/card boundaries. Test Firecrawl's documented [product format](https://docs.firecrawl.dev/features/scrape#extract-product-data) on product URLs. If the exact product page lacks its own price, try one bounded same-item listing-card fallback with exact URL/product-ID and variant matching. Never accept the price of a recommendation, former price, or unit price as the current item price.
- **Useful list page rejected:** Allow a list page into the *collection discovery* stage, not into the single-item extractor as a fake one-record page.
- **Sparse but relevant page:** Keep known fields and explicit nulls when allowed; do not require every optional field to appear on one page. If the only field the user asked for (for example price) is absent, do not save a misleading “successful” record.
- **Unsupported/login/location-gated site:** Do not keep retrying the same domain. Explain the limitation and, only if the user's request permits it, look for another public source. A country-level Firecrawl location is not the same as a selected retail store or ZIP.

Firecrawl's [Scrape documentation](https://docs.firecrawl.dev/features/scrape) describes Markdown, JSON, product output, page status, and location options. Verify actual behavior with a controlled sample; a documented format does not guarantee the site exposes the requested data.

### 6. Keep recovery finite and tailored

Recovery should use the classified failure and uncovered requested entities/fields, not just “no records yet.” Allow only a bounded alternate search or same-item fallback when it can plausibly address the cause. Count every search, scrape, vision call, and model decision against the selected search-depth limits and four-minute deadline. Never repeat a failed URL within one run. Do not add a daily credit cap for the hackathon demo. Show estimated calls before running and actual call counts afterward; Firecrawl's dashboard remains authoritative for charged credits.

A final message must prioritize the real cause, e.g. “No matching product price visible,” “3 of 6 courses found,” “source blocked,” or “worker offline.” “Recovery found no better query” should be secondary detail.

### 7. Preserve valid data and represent partial results honestly

A refresh must retain the last verified record if a new attempt fails; show extraction timestamp and staleness. Mark Ready only when the API's promised record shape is actually useful. Partial data must identify missing members or fields. If no verifiable required value exists, return a clear failure rather than an invented value. Keep sources/field provenance in records.

## Acceptance checks

- Espresso prompt produces a plan for separate real machines, no `XYZ`, no combined record, and at least two distinct product records when suitable pages are available.
- Waterloo 1A prompt produces separate course records with no unrequested professor/location fields. It reports discovered-versus-saved course counts, not one combined course.
- Walmart grape prompt either saves a price tied to the exact grape product/variant or clearly says why a verifiable price is unavailable. Related-item prices remain rejected.
- MDN JavaScript/HTML/CSS run still yields three records; the reliability changes do not regress a previously working example.
- Mocked cases cover source-review false negatives, all-null JSON, sparse relevant data, wrong entity, blocked sites, a missing price, related-item price, timeout, cancellation, worker offline, exhausted budgets, and refresh preservation.
- `npm test`, `npm run lint`, `npm run build`, then a small number of controlled live runs pass. Record expected and actual output for each live prompt. Stop broad live testing once the failing stage is known.

## Priority and boundaries

1. **P0:** Run diagnostics, regression fixtures, and worker visibility. This tells us why each API fails and prevents blind paid retries.
2. **P1:** Finish planner end-to-end and fix false source/record/price rejections without accepting wrong data.
3. **P2:** Multi-record collection extraction and source-specific bounded fallbacks.
4. **P3:** Better replan and partial-data controls in the UI.

This plan does not promise access to private, login-only, location-dependent, or unsupported pages. It does require WebForge to distinguish those limits from its own bugs and to avoid turning either into a misleading API.
