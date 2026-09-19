# Force Firecrawl Support: bounded source recovery plan

## Goal

When Firecrawl cannot extract a record from a page, WebForge should find another usable public source without repeatedly paying to retry the same failure. This plan adds one optional OpenAI recovery decision to the existing OpenAI planning → Firecrawl search → Firecrawl JSON scrape → SQLite → records API pipeline.

**Chosen approach:** deterministic handling first, one bounded LLM recovery call only when automatic discovery runs out of useful candidates. The LLM may suggest a new *search query* or stop. It cannot call tools, choose arbitrary URLs, change the schema, or request another recovery call. Provided-URL jobs never silently switch to other sources.

Implemented in the WebForge codebase. This document records the intended behavior and acceptance checks.

## Why the current run behaved this way

- `src/lib/providers/firecrawl.ts` searches the web, takes the first five normalized URLs, then calls Firecrawl's JSON scrape on each.
- `src/lib/pipeline.ts` catches each scrape error and continues. It has no domain exclusions, replacement candidates, error classification, or explicit recovery budget.
- Instagram and Facebook were explicitly rejected by Firecrawl. The Empire State Building page returned no JSON object. A null JSON response is a page extraction failure, not a valid record with missing fields.
- Two other pages succeeded, so the job stayed `ready` with a warning. Those pages were not the single Eiffel Tower source intended for the test. A search result being scrapeable does not prove it is relevant.
- The user can avoid source discovery for a known page by choosing **Provided URLs**. Automatic discovery needs the recovery work below.

## Limits that must be enforced in code

Use named constants in one server-side `runBudget.ts` module. These are hard per-run ceilings, not prompts to the LLM. Configuration may lower them, but must not raise them without a code change.

| Limit | Initial value | Behavior at limit |
| --- | ---: | --- |
| Firecrawl Search calls | 2 | Stop searching; one initial query and at most one recovery query |
| Firecrawl JSON Scrape calls | 3 | Stop scraping, including failed calls |
| OpenAI recovery calls | 1 | No further model-directed recovery |
| Consecutive source failures | 3 | Stop the run immediately; reset counter only after a saved usable record |
| Total source failures | 3 | Stop even if successes separated the failures |
| Candidate URLs inspected | 8 | Do not add more URLs to the queue |
| Run duration | 90 seconds | Abort or time out outstanding work; do not start another call |

A planning call made by `POST /api/jobs` is separate from the one recovery call allowed in a run. Do not use recursive retries. Disable SDK automatic request retries: use `maxRetries: 1` for Firecrawl because this SDK counts total attempts, and `maxRetries: 0` for OpenAI; give search, scrape, and OpenAI calls finite timeouts. Check the remaining run budget **before** every paid call and increment the counter before making it, so a thrown request still counts. A user can explicitly click Refresh to start a new run; no scheduler currently exists.

The limits bound our planned calls, not Firecrawl's final bill. At the current published rates, two searches of at most ten results and three JSON scrapes would be **up to roughly 19 credits for one run** (two × two search credits plus three × five scrape/JSON credits). An ordinary run without recovery uses at most one search plus three scrapes, roughly 17 credits. Keep search results at five per query; this still falls inside Firecrawl's two-credit search tier. Check current rates and the Firecrawl dashboard before relying on these estimates; a provider pricing change could make the actual charge differ. [Firecrawl pricing](https://www.firecrawl.dev/pricing), [Search cost documentation](https://docs.firecrawl.dev/features/search), [Scrape documentation](https://docs.firecrawl.dev/features/scrape).

## Error classification

Convert exceptions and scrape metadata into internal codes in `src/lib/providers/firecrawl.ts`. Do not pass raw Firecrawl text, page text, or suggested marketing links into the recovery prompt.

| Code | Examples | Action |
| --- | --- | --- |
| `UNSUPPORTED_SITE` | Firecrawl explicitly says the domain is unsupported; Instagram/Facebook examples | Do not scrape that domain again in this job; continue with another candidate |
| `ACCESS_BLOCKED` | Login wall, 401/403, blocked page | Skip URL; do not retry it in this run |
| `NO_STRUCTURED_JSON` | `result.json` is null or not an object | Skip this exact URL; do not blacklist the entire domain |
| `SCHEMA_MISMATCH` | Extracted value has an invalid type | Skip this URL; preserve the validation error code |
| `SOURCE_HTTP_ERROR` | Target page 404/5xx in metadata | Skip URL; do not retry automatically in this version |
| `RATE_LIMITED` | Firecrawl 429 or quota exhausted | Stop immediately; no recovery call |
| `CONFIG_OR_BILLING` | Missing/invalid API key, payment or permission failure | Stop immediately; no recovery call |
| `TRANSIENT` | Timeout/network problem | Skip URL; no same-run retry in the first implementation |

A planned field returning `null` is allowed. A response with **every user field null** is not a usable record; classify it as `NO_STRUCTURED_JSON` or `NO_USABLE_FIELDS`. `source_url` does not count as a user field. Keep the existing rule that a bad source never overwrites a previously saved good record.

## Source selection before spending scrape credits

1. Keep a short, explicit unsupported-domain list seeded with `instagram.com` and `facebook.com`, matching subdomains as well. Do not claim all social media is unsupported without evidence.
2. Persist job-specific domains that Firecrawl *explicitly* reports as unsupported. A null JSON result or one blocked page only excludes that URL, not an entire domain. Normalize domain names before storing them.
3. Pass unsupported domains to Firecrawl Search through `excludeDomains`, then filter returned URLs locally as a second guard. Firecrawl documents `excludeDomains`; it cannot be combined with `includeDomains` in the same search call. When a request specifies an included domain, use `includeDomains` and retain the local denylist check. [Firecrawl domain filters](https://docs.firecrawl.dev/features/search).
4. Keep search-result title, description, and URL until candidate selection. Deduplicate URLs, reject obviously unsupported or non-public URLs, and skip clear result-list/search/category pages where a single item page is required. Avoid broad site-wide bans based on a single bad page.
5. Try unvisited candidates from the existing search results before asking OpenAI to search again. Never scrape the same URL twice in one run.

For `provided_urls`, skip automatic discovery and the OpenAI recovery call. If an explicit source is unsupported, report it clearly and let the user replace that URL. Do not quietly substitute a different website.

## One bounded OpenAI recovery decision

Add `src/lib/source-recovery.ts` with a function such as:

```ts
recoverSearchQuery(input: {
  userRequest: string;
  priorQueries: string[];
  failureCodes: Array<{ domain: string; code: SourceFailureCode }>;
  excludedDomains: string[];
  successfulRecordCount: number;
}): Promise<{ action: "search_again" | "stop"; query: string | null }>;
```

Use the existing configurable `OPENAI_MODEL` (default `gpt-4.1-mini`) and the Responses API with a strict JSON Schema, `max_output_tokens` around 200–300, finite timeout, and no tools. OpenAI's Structured Outputs support `text.format` with `json_schema` and `strict: true`. [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

The model sees only the original request, prior queries, normalized failure codes, and domains. It must return either `stop` or one focused query for a public item page. It must not output a URL to scrape, instructions to bypass a login, a different schema, or another recovery action. Validate the query with Zod: length 3–160 characters, distinct from earlier queries, no URL scheme, no unsupported domains, and no private/local target. Invalid output means `stop`; never reprompt.

Call this function only for **automatic** jobs when:

- fewer than two usable records have been saved in the current run;
- the candidate queue is exhausted or all remaining candidates are excluded;
- a failure or empty search actually occurred;
- every hard limit still has room; and
- no recovery call has already happened.

The LLM's `search_again` response triggers exactly **one** Firecrawl Search call. New results enter the same deduplicated queue and use the remaining scrape budget. A `stop` response ends the run. If three consecutive source failures have already occurred, stop *without* calling the LLM. This stop rule takes precedence over recovery.

## Finite run flow

```text
load job and budget
→ for automatic jobs, search one initial query
→ filter, deduplicate, queue candidates
→ scrape next candidate if budget permits
   → success: validate, save record, reset consecutive failure counter
   → failure: classify, count, skip URL; stop at threshold
→ if fewer than 2 records and queue exhausted, maybe call recovery LLM once
→ if LLM says search_again, make at most one extra search and use remaining scrape slots
→ finish: no more model or Firecrawl calls from this run
```

Do not wait until the end to save successful records: save each valid record (or a successful batch transaction) so an aborted run retains its successes. If at least one new or previous record exists, keep the records endpoint usable and show a `partial` or `stopped` run warning. If the run produced no records and none were previously stored, mark the job `failed`. The warning must say **why** the run stopped, for example: “Stopped after 3 consecutive source failures; 2 records remain available.” A run with a fatal key/billing/rate-limit error should surface that error immediately.

## Data and API changes

1. Add `SourceFailureCode`, `RunBudget`, `RunSummary`, and `stopReason` types in `src/lib/types.ts`.
2. Add a small `api_job_runs` table in `src/lib/store.ts`: run ID, job ID, start/end times, counts for search/scrape/recovery calls, consecutive and total failures, saved record count, outcome, and stop reason. Add either a job-level `blocked_domains_json` column or a separate job-domain table for explicitly unsupported domains. Do not store raw external error prose as a control input.
3. Extend `ExtractionProvider.discover` to accept `limit` and exclusion options and return candidate metadata rather than only five URLs. Keep `extract` returning the same `ApiRecordData`, so the future local Qwen provider boundary remains intact.
4. Refactor `runApiJob` in `src/lib/pipeline.ts` into one iterative loop governed by the budget. The `runningJobs` guard stays. Make all exits persist a final run summary.
5. Include a concise `run_summary` in `GET /api/jobs/:id` and the `POST /run` and `/refresh` responses. Leave `GET /records` backed only by SQLite, with no model or Firecrawl calls.
6. Update `src/components/workspace.tsx` to display records saved, sources skipped, recovery used (0 or 1), estimated credits for this run and the stop reason. Replace the raw Firecrawl apology/Typeform text with a concise supported error message and source URL.
7. Keep the existing `ready` status semantics: records are available. A partial run may be `ready` with a warning. A run with no records is `failed`. Optionally add a separate run outcome `partial_stopped`; do not overload the job status to imply every source succeeded.

## Implementation order

1. Add budget and failure-code types plus pure classification/domain-filter helpers.
2. Add mocked tests for classification and URL filtering, especially Instagram/Facebook and a null JSON Wikipedia page.
3. Update the Firecrawl provider: bounded search options, candidate metadata, finite timeouts, retry settings, and normalized errors.
4. Add the strict one-call OpenAI recovery function and validate its response.
5. Refactor `runApiJob` into the finite state flow above; persist run counters and blocked domains.
6. Expose a run summary through the existing API routes and show it in the dashboard.
7. Update README and `.env.example` with the default limits and cost behavior; keep API keys server-side and ignored by Git. Document that per-run cost is an estimate and Firecrawl's dashboard is authoritative for actual credits.
8. Run the test suite, lint, and build. Use mocked Firecrawl/OpenAI responses for loop-limit tests. Perform at most one real provided-URL smoke run and one real automatic run if keys/credits are available.

## Acceptance tests

- Search returns Instagram, Facebook, and a useful public page: unsupported domains are skipped before scrape; only the useful page is charged for JSON scraping.
- A page returns `json: null`: skip that URL and try another; other pages on the same domain remain eligible.
- Two candidates fail and the queue empties: one OpenAI recovery call may return one new query; never a second recovery call.
- Three consecutive candidates fail: run stops before another search, scrape, or OpenAI call; the stop reason is recorded.
- Failures separated by successes still stop at three total failures or three scrapes; a success resets only the consecutive counter.
- OpenAI recovery returns malformed output, a URL, a repeated query, or `stop`: no further Firecrawl call.
- A provided Instagram URL reports an unsupported source; it does not trigger automatic discovery or model recovery.
- Firecrawl quota/auth errors stop immediately, with no additional calls.
- Successful records survive a failed or stopped refresh and remain visible at `GET /api/jobs/:id/records`.
- Raw Firecrawl error text and page content never enter the OpenAI recovery request or the user-facing error banner.

## Later safeguards

If scheduled refresh is added, persist a cross-run circuit breaker: after two consecutive fully failed scheduled runs, pause that job until a user explicitly resumes it. Manual refresh is the only trigger today, so this is not required for the first recovery implementation. Before public deployment, add API authentication and account-level spending controls; per-run request caps cannot prevent an external caller from repeatedly creating new jobs.
