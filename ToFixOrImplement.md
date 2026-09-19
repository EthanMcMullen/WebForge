# To Fix or Implement — teammate handoff

Last reviewed: September 19, 2026. Status reflects the current working tree. Checked boxes mean the named behavior exists and has been verified; unchecked boxes are still work to do. A section marked **PARTIAL** contains both.

## Current working path

- Plain-English request -> OpenAI plan -> user chooses fields -> Firecrawl search and structured extraction -> SQLite records -> JSON endpoints.
- Automatic discovery has Focused (up to two searches/three scrapes), Balanced (four/six, default), and Deep (five/twelve) modes. It gives each searched subject a source attempt before fallback pages and labels missing subjects **Partial data**. One optional recovery search remains bounded. Every run also has one recovery decision, five source failures, and four minutes. Combined-source runs stop early when all requested fields are populated. These are ceilings, not expected usage.
- The existing MDN JavaScript/HTML/CSS API has three records. Earlier live isolated tests confirmed both three-of-three **Ready** and one-missing **Partial data** outcomes. The current mocked suite has 57 passing tests, and lint and build pass.
- `refresh_interval` schedules work through the separate `npm run worker` process. Restart the server and worker after changing keys or pulling code. `.env.local` and `.data/` are ignored by Git.

## 1. Discovery and failed extraction — PARTIAL

**RESOLVED (specific Walmart Golden Delicious apple regression).** The app reaches a relevant fresh-apple page, rejects an unrelated recommendation price, and can use the matching category card. A live run saved the $0.89 price. The original bad run had accepted an apple tree and an unverified category price; those old records should not be treated as evidence of correctness.

Completed:

- [x] Ask the planner for an item identity field and focused search queries. For explicitly named subjects, ask for a separate query per subject.
- [x] Normalize and deduplicate public URLs; skip known unsupported social domains and obvious list/category pages before structured extraction.
- [x] Review search candidates against the user request and the individual search query before paying to scrape them.
- [x] Distinguish unsupported sites, missing structured JSON, schema mismatch, blocked pages, rate limits, and billing errors. Reject all-null or very sparse records.
- [x] Check numeric product prices against nearby source text; reject the unrelated Walmart apple recommendation price.
- [x] Use fixed per-run call and time ceilings, one bounded OpenAI recovery decision, and no same-run repeat scrape of a failed URL.
- [x] Search every planned subject, prioritize one candidate per subject, and show **Partial data** with the missing searches when some subjects yield no record. Refresh uses the same behavior.
- [x] Keep previously saved records if a later run fails. Show search, scrape, recovery, skipped-source, and outcome counts for the latest run.
- [x] Add focused tests for unsupported sources, apple price evidence, sparse JSON, call limits, query coverage, and candidate ordering. Live-test complete and incomplete MDN runs.

Still to do:

- [x] Suggest a likely source-name correction when discovery finds no usable page, while preserving the original request. The Fresco/FreshCo case has a mocked regression.
- [x] Review extracted records against the original request and planned subject before saving. A mocked full-pipeline wrong-retailer regression rejects a scrapeable but irrelevant record.
- [x] Extract an internal identity field for relevance review without exposing it in the public record schema.
- [ ] Save safe per-source diagnostic metadata for failed Firecrawl attempts. The old Walmart `no structured JSON` response cannot be diagnosed from persisted data alone.
- [ ] Show estimated and actual Firecrawl credit use per run. The dashboard remains the authoritative source for actual charges.
- [ ] Make the per-run budget configurable below its hard ceiling if needed; the current limits are fixed in code.
- [x] Base recovery on uncovered planned subjects and add repeatable mocked pipeline regressions for wrong retailer, typo discovery, refresh preservation, cancellation, and scheduling.

## 2. Optional local extraction model — TODO

- [ ] Add Ollama with local Qwen as an optional extractor. Keep OpenAI for initial planning and Firecrawl structured extraction as the default.
- [ ] For the local path, have Firecrawl fetch raw page content and send it to Qwen to fill the already selected schema. Both extractors must return the same record shape.
- [ ] Add an extractor setting, model setup/hardware/timeouts documentation, unavailable-Ollama handling, and quality/speed/cost comparisons on the same pages.

## 3. UI and workflow — PARTIAL

Completed:

- [x] Clicking WebForge opens the home view. New API has its own creation view; existing APIs have a library view and detail view.
- [x] Show proposed fields in a focused selection step before Firecrawl starts.
- [x] Show live run status, latest run counts, records, schema, refresh control, and copyable endpoints on the API detail view.
- [x] Add a top-right workspace settings menu, basic empty/error states, responsive layouts, and fix the previously broken character encoding.
- [x] Correct the dashboard record total to count records actually stored, not only records saved in the latest run.

Still to do:

- [x] Queue runs in SQLite for a separate worker, retry an interrupted run after its lease expires, and add cancellation and progress polling after navigation.
- [x] Show source URLs and recent run history on the API detail view.
- [ ] Expand settings/account navigation beyond connection status and the shared-workspace lock. Review keyboard focus/trapping and mobile layouts with hands-on testing.
- [ ] Continue the visual redesign; the present dashboard and detail layout are functional but not final.

## 4. Automatic refresh — PARTIAL

- [x] Use a separate worker and SQLite queue to schedule `refresh_interval`, recover expired leases, and prevent overlapping runs. A closed localhost server still cannot refresh itself.
- [x] Reuse the confirmed schema and known source strategy without rerunning the initial planner. Track next refresh, run history, and consecutive scheduled failures.
- [x] Pause scheduling after two failed scheduled runs and display that state in the UI; saving settings resumes it.
- [ ] Add record change history, actual credit tracking, and external failure alerts before offering a paid recurring service.

## 5. Accounts and ownership — TODO

A shared `WEBFORGE_ACCESS_TOKEN` now protects the UI/API when configured and is required in production. It is **not** multi-user authentication.

- [ ] Add real sign-up/sign-in, sessions, user ownership of jobs/records/runs, and ownership checks on every read/write endpoint.
- [ ] Add per-user or scoped API tokens and account-level spending controls. Plan how existing local jobs are assigned to users.

## 6. Manage APIs after creation — PARTIAL

Completed:

- [x] Rename an API, change its stored refresh interval, and delete it from the detail view.
- [x] Bind the settings dialog to the API it opened for, so switching selection cannot edit/delete another API.
- [x] Prevent settings changes or deletion while a job is active; a running job cannot resurrect a deleted API.

Still to do:

- [ ] Edit a request, selected fields, or source URLs after creation, with clear rules for replanning and re-extraction.
- [ ] Add folders/collections, moving, and archiving. Preserve old records until replacement data succeeds and explain the impact of edits.

## 7. Test the product aggressively — PARTIAL

Completed:

- [x] Run automated tests, lint, and production build after the latest fixes.
- [x] Perform controlled live Firecrawl tests for a known page and automatic MDN discovery. Inspect actual records and endpoint JSON, not only the Ready label.
- [x] Verify an isolated missing-subject run becomes Partial data and names the missing search; verify the complete three-subject run stays Ready.

Still to do:

- [ ] Expand mocked full-pipeline coverage to duplicate results, rate limits, timeouts, and all recovery branches. User isolation depends on accounts.
- [ ] Explore the UI manually on desktop/mobile, including keyboard dialogs and page navigation during a run. Record prompt, fields, sources, expected data, actual data, and run summary for each new bug.

## Suggested next order

1. Add safe per-source diagnostic metadata and credit tracking.
2. Add record change history and external failure alerts for scheduled refresh.
3. Expand full-pipeline regression coverage and perform hands-on UI testing.
4. Add real accounts, ownership, and spending controls before public deployment.
5. Add deeper API editing and the optional Ollama/Qwen extractor.
