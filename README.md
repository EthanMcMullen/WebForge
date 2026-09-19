# WebForge

WebForge turns a plain-English request for public web data into a JSON API. OpenAI plans a record schema and search queries. Firecrawl finds public pages and extracts structured fields. WebForge saves the records in SQLite and serves them through an API endpoint. A job can also combine facts from several pages about one item into one record.

## Run locally

Requires Node.js 24 or newer, an OpenAI API key, and a Firecrawl API key.

```powershell
npm install
Copy-Item .env.example .env.local
```

Set `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`, and a long random `WEBFORGE_WORKER_TOKEN` in `.env.local`. For shared access or deployment, also set `WEBFORGE_ACCESS_TOKEN` to a different long random value. Start the web server and worker in separate terminals:

```powershell
npm run dev
```

In another terminal:

```powershell
npm run worker
```

Open [http://localhost:3000](http://localhost:3000). Enter a request such as “Create an API with the title, author, and publication date of recent articles about battery recycling.” Choose automatic discovery or supply up to five public page URLs. Click **Propose fields**, choose the fields you want in the JSON API, then click **Build API**. Firecrawl runs only after confirmation.

For one item whose fields come from different sites, check **Combine sources into one record**. For example, request “iPhone 16 Pro display size from Apple and single-core benchmark score from Geekbench,” then select both fields. You can provide the two page URLs or let automatic discovery find a page for each field group. The planner can also select this mode when your request clearly calls for one item with complementary sources. Keep it off when you want a separate record per item or URL.

`OPENAI_MODEL` defaults to `gpt-4.1-mini`. `WEBFORGE_DB_PATH` defaults to `.data/webforge.sqlite` under the project directory. The `.env.local` file and database are ignored by Git. The worker polls every five seconds, executes queued runs, and schedules due refreshes. Keep it running alongside the web server. `WEBFORGE_BASE_URL` can point the worker to a nondefault server address.

## Access

Local development runs without an access token unless you configure one. Production requires `WEBFORGE_ACCESS_TOKEN`; the UI asks for it before loading API data. Programmatic API callers send `Authorization: Bearer <WEBFORGE_ACCESS_TOKEN>`. This is a shared workspace gate, not separate user accounts. Keep the token private and use HTTPS when hosting WebForge.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/config` | Reports which service keys are configured |
| GET | `/api/jobs` | Lists jobs |
| POST | `/api/jobs` | Plans a draft job with OpenAI; no Firecrawl call |
| PATCH | `/api/jobs/:id/fields` | Confirms selected fields before extraction |
| GET | `/api/jobs/:id` | Returns job status and confirmed schema |
| GET | `/api/jobs/:id/schema` | Returns the record schema |
| POST | `/api/jobs/:id/run` | Queues discovery and extraction; returns 202 |
| POST | `/api/jobs/:id/refresh` | Queues another run; returns 202 |
| POST | `/api/jobs/:id/cancel` | Requests cancellation of the active run |
| GET | `/api/jobs/:id/runs` | Returns full run history |
| GET | `/api/jobs/:id/records` | Returns saved records without calling a model or Firecrawl |

Example creation request:

```powershell
$body = @{
  user_request = "Track the title, author, and publication date of recent articles about battery recycling."
  source_strategy = @{ type = "automatic"; search_queries = @() }
  sources = @()
  refresh_interval = $null
} | ConvertTo-Json -Depth 4
$job = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/jobs -ContentType application/json -Body $body
$fields = @($job.job.proposed_schema.PSObject.Properties.Name | Where-Object { $_ -ne "source_url" } | Select-Object -First 2)
$selection = @{ selected_fields = $fields } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "http://localhost:3000/api/jobs/$($job.job.id)/fields" -ContentType application/json -Body $selection
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/jobs/$($job.job.id)/run"
# Poll the job until its status is ready, partial, or failed, then read records.
Invoke-RestMethod -Uri "http://localhost:3000/api/jobs/$($job.job.id)/records"
```

For known pages, set `source_strategy.type` to `provided_urls` and supply `sources` as an array of public HTTP(S) URLs. A draft job cannot call `/run` or `/refresh` until fields are confirmed. After confirmation, field selection is locked for that job; create another job to use a different schema.

Set `combine_sources` to `true` in `POST /api/jobs` to merge complementary fields from those URLs into one record. The automatic strategy can also plan source-specific searches for the same entity. The confirmed schema and source mode are fixed for that job.

A records response has `job_id`, `status`, `count`, and `records`. Each record includes `id`, `source_url`, `source_urls`, `field_sources`, `data`, and `extracted_at`. `data` contains every selected field, using `null` when unavailable. In a combined record, `source_url` is the primary URL, `source_urls` lists pages that contributed fields, and `field_sources` maps each populated field to its page. A refresh that cannot verify previously populated fields keeps the earlier combined record and reports a partial run.

## How it works

1. The dashboard sends the plain-English request to `POST /api/jobs`.
2. OpenAI Responses proposes a schema and search queries. The draft is saved with status `awaiting_fields`; no Firecrawl call is made.
3. The user selects at least one proposed data field. `source_url` is always included. `PATCH /api/jobs/:id/fields` saves the confirmed schema.
4. Firecrawl Search discovers public candidate pages for automatic jobs and excludes known unsupported domains. Provided URL jobs skip search and never switch to other sources.
5. A separate worker claims the queued run. Firecrawl Scrape extracts the confirmed fields plus an internal identity field that is not served through the public API.
6. WebForge checks the JSON shape and reviews each extracted page against the original request and planned subject. Combined jobs allow a page to supply a sparse subset, then merge populated fields only when the pages describe the same entity. Conflicting values retain the first source and appear in the run warning.
7. `GET /api/jobs/:id/records` serves the stored JSON. The UI and `/runs` endpoint show progress and history.

`awaiting_fields` means OpenAI has proposed fields and the user must confirm a selection. `planned` means a confirmed schema exists but extraction has not finished. `queued` means the worker has not claimed the run yet. `ready` means at least one record was saved. Other statuses show discovery, scraping, extraction, storage, or failure. A partial failure sets the job to `partial` and the latest run to `partial_stopped`; saved records stay available. The latest run summary shows search, scrape, recovery, and skipped-source counts.

## Current scope

- By default one source page produces one record. Combined mode targets one entity and produces one record from up to five scraped pages. Broad list pages may not yield every item on the page.
- Each run allows at most five planned Firecrawl searches plus one recovery search, five structured scrapes, one OpenAI recovery decision, five source failures, and four minutes. Search candidates are reviewed by OpenAI before scraping. Each planned search gets its best page considered before fallback pages, and incomplete subjects are reported as partial results. These are per-run limits; there is no daily credit cap. Check your Firecrawl dashboard for actual credits used.
- Known unsupported social domains are skipped before scraping. Firecrawl errors are classified, and an automatic job can ask OpenAI for one alternate search query when candidate pages run out. Provided URL jobs do not switch sources. Source review and numeric-price evidence checks reduce mismatches, but other extracted fields are not independently fact checked.
- A configured `refresh_interval` schedules refreshes while the worker runs. Refreshes reuse the confirmed schema and source strategy. A job pauses scheduled refreshes after two runs that make no usable progress; saving its settings resumes the schedule. Run history and the paused state appear in the UI.
- Fields visible only in product images, OCR, login-only pages, and private pages are outside this version.
- Automatic discovery checks whether search results match the request before scraping. Extracted records get a separate relevance check. If discovery finds no usable pages and detects a likely source-name typo, WebForge suggests the correction without changing the original request. For numeric prices, extraction also checks that the price appears next to the matching item in the page text. If a product page lacks its own price but a linked category card shows it, one bounded category-page fallback may supply the record.
- The extraction provider is behind `ExtractionProvider` in `src/lib/providers/firecrawl.ts`, so a later local Qwen provider can return the same record shape.
- A shared token protects the API when configured; individual user accounts are not implemented. The worker needs a long-lived Node.js server and a writable SQLite volume. Queued runs remain in SQLite across restarts; an interrupted run is retried after its lease expires, and already saved records remain available.

## Verify

```powershell
npm test
npm run lint
npm run build
```
