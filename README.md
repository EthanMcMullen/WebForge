# WebForge

WebForge turns a plain-English request for public web data into a JSON API. OpenAI plans a record schema and search queries. Firecrawl finds public pages and extracts one structured record per page. WebForge saves the records in SQLite and serves them through an API endpoint.

## Run locally

Requires Node.js 24 or newer, an OpenAI API key, and a Firecrawl API key.

```powershell
npm install
Copy-Item .env.example .env.local
```

Set `OPENAI_API_KEY` and `FIRECRAWL_API_KEY` in `.env.local`. For shared access or deployment, also set `WEBFORGE_ACCESS_TOKEN` to a long random value. Then run:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter a request such as “Create an API with the title, author, and publication date of recent articles about battery recycling.” Choose automatic discovery or supply up to five public page URLs. Click **Propose fields**, choose the fields you want in the JSON API, then click **Confirm fields and build API**. Firecrawl runs only after confirmation.

`OPENAI_MODEL` defaults to `gpt-4.1-mini`. `WEBFORGE_DB_PATH` defaults to `.data/webforge.sqlite` under the project directory. The `.env.local` file and database are ignored by Git.

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
| POST | `/api/jobs/:id/run` | Discovers and extracts records |
| POST | `/api/jobs/:id/refresh` | Runs extraction again |
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
Invoke-RestMethod -Uri "http://localhost:3000/api/jobs/$($job.job.id)/records"
```

For known pages, set `source_strategy.type` to `provided_urls` and supply `sources` as an array of public HTTP(S) URLs. A draft job cannot call `/run` or `/refresh` until fields are confirmed. After confirmation, field selection is locked for that job; create another job to use a different schema.

A records response has `job_id`, `status`, `count`, and `records`. Each record includes `id`, `source_url`, `data`, and `extracted_at`. `data` contains every planned field, using `null` when the extracted value is unavailable. WebForge adds `source_url` from the actual page URL. Records remain available if a later refresh fails; the job status and error report the failure.

## How it works

1. The dashboard sends the plain-English request to `POST /api/jobs`.
2. OpenAI Responses proposes a schema and search queries. The draft is saved with status `awaiting_fields`; no Firecrawl call is made.
3. The user selects at least one proposed data field. `source_url` is always included. `PATCH /api/jobs/:id/fields` saves the confirmed schema.
4. Firecrawl Search discovers public candidate pages for automatic jobs and excludes known unsupported domains. Provided URL jobs skip search and never switch to other sources.
5. Firecrawl Scrape's JSON format extracts a record using only the confirmed field schema.
6. WebForge checks the returned JSON shape, rejects empty or very sparse records, and saves each successful record immediately in SQLite.
7. `GET /api/jobs/:id/records` serves the stored JSON.

`awaiting_fields` means OpenAI has proposed fields and the user must confirm a selection. `planned` means a confirmed schema exists but extraction has not finished. `ready` means at least one record was saved. Other statuses show discovery, scraping, extraction, storage, or failure. A partial failure can leave the job `ready`, while the latest run shows `partial_stopped`. The latest run summary shows search, scrape, recovery, and skipped-source counts.

## Current scope

- One source page produces one record. Broad list pages may not yield every item on the page.
- Each run allows at most two Firecrawl searches, five structured scrapes, one OpenAI recovery decision, three source failures, and 90 seconds. Search candidates are reviewed by OpenAI before scraping. These are per-run limits; there is no daily credit cap. Check your Firecrawl dashboard for actual credits used.
- Known unsupported social domains are skipped before scraping. Firecrawl errors are classified, and an automatic job can ask OpenAI for one alternate search query when candidate pages run out. Provided URL jobs do not switch sources. Source review and numeric-price evidence checks reduce mismatches, but other extracted fields are not independently fact checked.
- Refresh is manual. `refresh_interval` is stored for later scheduling but does not trigger automatic runs.
- Fields visible only in product images, OCR, login-only pages, and private pages are outside this version.
- Automatic discovery checks whether search results match the request before scraping. For numeric prices, extraction also checks that the price appears next to the matching item in the page text. If a product page lacks its own price but a linked category card shows it, one bounded category-page fallback may supply the record.
- The extraction provider is behind `ExtractionProvider` in `src/lib/providers/firecrawl.ts`, so a later local Qwen provider can return the same record shape.
- A shared token protects the API when configured; individual user accounts and a hosted background worker are not implemented.

## Verify

```powershell
npm test
npm run lint
npm run build
```