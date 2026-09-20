# WebForge

WebForge turns a plain-English request for public web data into a JSON API. OpenAI plans a record schema and search queries. Firecrawl finds public pages and extracts structured fields. WebForge saves the records in MongoDB Atlas and serves them through an API endpoint. A job can also combine facts from several pages about one item into one record.

## Run locally

Requires Node.js 24 or newer, a MongoDB Atlas cluster, an OpenAI API key, and a Firecrawl API key.

```powershell
npm install
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Set `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`, `MONGODB_URI`, and a long random `WEBFORGE_WORKER_TOKEN` in `.env.local`. Copy the Atlas Node.js driver connection string into `MONGODB_URI`, replacing the database username and password placeholders locally. Add your current IP in Atlas Network Access. Keep the full URI private and do not commit `.env.local`. Percent-encode reserved characters in the password when inserting it into the URI. For shared access or deployment, also set `WEBFORGE_ACCESS_TOKEN` to a different long random value. Start the web server and worker in separate terminals:

```powershell
npm run dev
```

In another terminal:

```powershell
npm run worker
```

Open [http://localhost:3000](http://localhost:3000). Enter a request such as “Create an API with the title, author, and publication date of recent articles about battery recycling.” Choose automatic discovery and a search depth, or supply up to five public page URLs. Click **Propose fields**, choose the fields you want in the JSON API, then click **Build API**. Firecrawl runs only after confirmation.

Automatic discovery offers three loose record targets: **Focused** uses up to two searches and three scrapes, **Balanced** (the default) uses up to four searches and six scrapes, and **Deep** uses up to five searches and twelve scrapes. These are ceilings rather than promised record counts. Runs stop early when enough data is found, and you can change the depth later in API Settings before a refresh.

For one item whose fields come from different sites, check **Combine sources into one record**. For example, request “iPhone 16 Pro display size from Apple and single-core benchmark score from Geekbench,” then select both fields. You can provide the two page URLs or let automatic discovery find a page for each field group. The planner can also select this mode when your request clearly calls for one item with complementary sources. Keep it off when you want a separate record per item or URL.

`OPENAI_MODEL` defaults to `gpt-4.1-mini`. `MONGODB_DB_NAME` defaults to `webforge`. MongoDB Atlas is the only database backend; older local SQLite jobs are not automatically migrated. `.env.local` is ignored by Git. Run `npm run db:check` to verify the Atlas connection before starting the app. Run `npm run test:db` for MongoDB pipeline integration tests after adding `MONGODB_URI`; they create and remove a separate temporary database. Set `WEBFORGE_TEST_MONGODB_URI` if you want those tests to use a different cluster. The worker polls every five seconds, executes queued runs, and schedules due refreshes. Keep it running alongside the web server. `WEBFORGE_BASE_URL` can point the worker to a nondefault server address.

## CLI / VS Code terminal

The CLI uses the same API, worker, database, depth limits, and access token as the dashboard. From the repository, start the complete local service in one VS Code terminal:

The site also serves a standalone, dependency-free client from `/cli`. Download `webforge-cli.mjs` there and run `node webforge-cli.mjs create --wait` from any VS Code terminal. The standalone file connects to an existing local or hosted WebForge service; it does not bundle the server or secret API keys.

```powershell
npm run cli -- serve
```

In another terminal, launch the interactive creation flow:

```powershell
npm run cli -- create --wait
```

To install the repository as a local command, run `npm link` once. You can then use:

```powershell
webforge create --request "List University of Waterloo CS courses and professors" --depth balanced --wait
webforge list
webforge status <job-id>
webforge records <job-id>
webforge refresh <job-id> --wait
```

Use `webforge help` for every option. `WEBFORGE_BASE_URL` defaults to `http://localhost:3000`. If shared access is enabled, the CLI reads `WEBFORGE_ACCESS_TOKEN` from `.env.local` and sends it as a bearer token. No VS Code extension is required; the command runs directly in its integrated terminal.

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
  search_depth = "balanced"
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
5. A separate worker claims the queued run. Firecrawl Scrape extracts the confirmed fields plus an internal identity field that is not served through the public API. When text scraping returns nothing usable (empty render, no structured JSON, malformed values), the worker takes up to two vision fallbacks per run: it screenshots the page with Firecrawl and reads the same fields off the screenshot with a vision-capable OpenAI model. Vision results pass through the same price-evidence, relevance, and quality gates, and the extra screenshot scrape counts against the run's scrape ceiling. Set `WEBFORGE_VISION_FALLBACK=0` to disable it, or `OPENAI_VISION_MODEL` to override the model.
6. WebForge checks the JSON shape and reviews each extracted page against the original request and planned subject. Combined jobs allow a page to supply a sparse subset, then merge populated fields only when the pages describe the same entity. Conflicting values retain the first source and appear in the run warning.
7. `GET /api/jobs/:id/records` serves the stored JSON. The UI and `/runs` endpoint show progress and history.

`awaiting_fields` means OpenAI has proposed fields and the user must confirm a selection. `planned` means a confirmed schema exists but extraction has not finished. `queued` means the worker has not claimed the run yet. `ready` means at least one record was saved. Other statuses show discovery, scraping, extraction, storage, or failure. A partial failure sets the job to `partial` and the latest run to `partial_stopped`; saved records stay available. The latest run summary shows search, scrape, recovery, and skipped-source counts.

## Current scope

- By default one source page produces one record. Combined mode targets one entity and produces one record from up to twelve discovered pages, or up to five URLs supplied directly by the user. Broad list pages may not yield every item on the page.
- Automatic runs use their selected depth ceiling: Focused allows two planned searches and three structured scrapes, Balanced allows four and six, and Deep allows five and twelve. Each mode reserves room for at most one recovery search. Every run also allows one OpenAI recovery decision, two vision fallbacks, five source failures, and four minutes. Search candidates are reviewed by OpenAI before scraping. Candidates are tried round-robin across planned searches, and combined-source runs stop early once every requested field is populated. Incomplete subjects are reported as partial results. These are per-run limits; there is no daily credit cap. Firecrawl's structured JSON extraction can cost more than a basic scrape, so check your Firecrawl dashboard for actual credits used.
- Known unsupported social domains are skipped before scraping. Firecrawl errors are classified, and an automatic job can ask OpenAI for one alternate search query when candidate pages run out. Provided URL jobs do not switch sources. Source review and numeric-price evidence checks reduce mismatches, but other extracted fields are not independently fact checked.
- A configured `refresh_interval` schedules refreshes while the worker runs. Refreshes reuse the confirmed schema and source strategy. A job pauses scheduled refreshes after two runs that make no usable progress; saving its settings resumes the schedule. Run history and the paused state appear in the UI.
- Fields visible only in product images, OCR, login-only pages, and private pages are outside this version, except for the bounded vision fallback above, which reads rendered page screenshots when text scraping fails.
- Automatic discovery checks whether search results match the request before scraping. Extracted records get a separate relevance check. If discovery finds no usable pages and detects a likely source-name typo, WebForge suggests the correction without changing the original request. For numeric prices, extraction also checks that the price appears next to the matching item in the page text. If a product page lacks its own price but a linked category card shows it, one bounded category-page fallback may supply the record.
- The extraction provider is behind `ExtractionProvider` in `src/lib/providers/firecrawl.ts`, so a later local Qwen provider can return the same record shape.
- A shared token protects the API when configured; individual user accounts are not implemented. The worker needs a long-lived Node.js server and access to MongoDB Atlas. Queued runs remain in MongoDB across restarts; an interrupted run is retried after its lease expires, and already saved records remain available.

## Verify

```powershell
npm test
npm run lint
npm run build
```
