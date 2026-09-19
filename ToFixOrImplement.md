# To Fix or Implement

This is the WebForge backlog. These items describe work to do; they are not implemented yet.

## 1. Fix discovery and failed extraction (highest priority)

**Observed case:** The request asked for the price of a Golden Delicious apple from Walmart. The run saved two records, skipped one source, used one search and three scrapes, made no recovery decision, and stopped at the three-scrape limit. The reported failed URL was a Walmart listing for a **five-gallon Golden Delicious apple tree**, not a grocery apple. Firecrawl returned no structured JSON from that page.

**What the code does today:** Automatic discovery accepts search results without checking whether they match the requested product. It tries at most three structured scrapes per run. Recovery requires a scrape slot and fewer than two saved records, so it cannot run after this result even if both records are irrelevant. A failed extraction consumes a slot. The strict cap protects credits but can cut off a valid replacement source.

**Fix:**
- Inspect the two saved records and the search results. Confirm whether either record is actually a Walmart grocery apple price.
- Check source relevance before saving: retailer, product/category, and requested fields. Reject an apple tree, generic article, or wrong retailer. Store the rejection reason.
- Improve the initial search query and candidate ranking. Filter titles/snippets cheaply before paying to scrape.
- Handle `no structured JSON` distinctly from unsupported sites, rate limits, and invalid data. Show the failed URL and a concise reason.
- Replace the fixed three-scrape cutoff with a configurable **per-run credit budget** plus a hard attempt limit. Permit bounded replacement candidates after irrelevant results or extraction failures. Show estimated and actual usage. Never repeatedly scrape the same failed URL.
- Base recovery on **relevant records**, not merely saved records. Keep a hard stop so errors cannot cause a feedback loop or uncontrolled spending.
- If no trustworthy match exists, report a failure or partial result rather than calling the API ready.
- Add a regression test for the Walmart fruit-versus-apple-tree case and for recovery within the spending cap.

The screenshot does not prove why Firecrawl returned no JSON from that Walmart page; inspect the provider response to determine that. The source mismatch and blocked recovery are visible problems regardless.

## 2. Implement the optional local extraction model

Implement the **local Qwen model through Ollama** discussed earlier. Keep OpenAI for the initial plain-English planning call. For this alternative extraction path, Firecrawl fetches raw page content (such as markdown), and Ollama/Qwen maps it into the already selected schema. Keep Firecrawl's native structured JSON extraction as the first option; choose the extractor in settings. Both paths must produce the same record shape for the existing database/API. Document model setup, hardware needs, timeouts, and behavior when Ollama is unavailable. Compare quality, speed, and cost on the same pages before changing the default.

## 3. Overhaul the UI and split the workflow into views

The current one-page dashboard needs a full visual and interaction redesign. Fix the visibly broken character encoding in labels and buttons.

- Clicking WebForge in the top left should open a real home/main menu.
- The top-right control should open a functional account/settings menu.
- Give **New API** its own page for the request and source options.
- Show proposed JSON fields in a focused selection dialog or step before Firecrawl starts.
- Show progress during discovery/extraction. Let the user leave while a durable background job continues, and provide a real cancel action.
- Put existing APIs in a separate library/list view. Give each API its own detail page for status, schema, records, sources, run history, refresh controls, and endpoints.
- Add useful settings, navigation, empty/error states, mobile layouts, and keyboard-accessible dialogs. Make the product feel responsive and complete.

## 4. Make automatic refresh real

Today `refresh_interval` is stored and displayed, but **nothing schedules it**; refresh is manual.

- Add a durable scheduler/worker that survives page closes and server restarts. Document how it runs locally and how it will run when hosted. A closed localhost app cannot refresh by itself.
- Reuse the confirmed schema and known source URLs at each interval. Do not repeat the initial OpenAI planning call every cycle.
- Track last and next refresh, changed records, failures, and credit usage. Prevent overlapping runs.
- If the page changes or data is missing, use bounded deterministic recovery first. Use one capped OpenAI recovery decision only if it can help locate a replacement source. Pause and alert after repeated failures.
- Keep history so users can see changes over time. Build reliable refresh before tying it to a monthly subscription.

## 5. Add accounts and ownership

Add basic sign-up/sign-in and sessions. Each API, record, and run must belong to one user; enforce ownership on listing, viewing, editing, refreshing, and API routes. Provide a scoped API token or equivalent for accessing generated endpoints. Add account-level spending limits before public deployment. Plan how existing local jobs are assigned so new users cannot see them.

## 6. Manage APIs after creation

From the library/detail views, let users rename APIs, edit the request/fields/sources and refresh interval, move them into folders or collections, and archive/delete them. Define which edits require a new plan or extraction run. Preserve old records until a replacement succeeds and show the impact of an edit before applying it.

## 7. Test the product aggressively

Use end-to-end tests and manual exploratory sessions that deliberately try to break it. Cover product ambiguity, wrong retailers, irrelevant/duplicate results, empty Firecrawl JSON, unsupported/login-only pages, rate limits, timeouts, failed recovery, cancellation, background navigation, refresh overlap, and user isolation. Check actual records and endpoint JSON, not only whether a job says `ready`. Record prompt, selected fields, source URLs, run summary, expected output, and actual output for each bug. Use mocked providers for repeatable tests and a small controlled set of live tests to check provider behavior without burning many credits.

## Suggested order

1. Fix source relevance, extraction failure handling, and the too-strict recovery budget.
2. Add stronger prompt-to-record tests.
3. Split the UI into create, progress, library, and detail views; fix navigation and encoding.
4. Add durable runs and scheduled refresh.
5. Add authentication, ownership, and API management.
6. Add the optional Ollama/Qwen extractor and compare it with Firecrawl structured extraction.
