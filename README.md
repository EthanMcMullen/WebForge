# WebForge

WebForge turns a plain-English request for public web data into a JSON API. OpenAI plans a record schema and search queries. Firecrawl finds public pages and extracts one structured record per page. WebForge saves the records in SQLite and serves them through an API endpoint.

## Run locally

Requires Node.js 24 or newer, an OpenAI API key, and a Firecrawl API key.

```powershell
npm install
Copy-Item .env.example .env.local
```

Set `OPENAI_API_KEY` and `FIRECRAWL_API_KEY` in `.env.local`, then run:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter a request such as “Create an API with the title, author, and publication date of recent articles about battery recycling.” Choose automatic discovery or supply up to five public page URLs. Click **Create API**. The app plans the fields, runs Firecrawl, shows saved records, and exposes a copyable records URL.

`OPENAI_MODEL` defaults to `gpt-4.1-mini`. `WEBFORGE_DB_PATH` defaults to `.data/webforge.sqlite` under the project directory. The `.env.local` file and database are ignored by Git.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/config` | Reports which service keys are configured |
| GET | `/api/jobs` | Lists jobs |
| POST | `/api/jobs` | Plans a job with OpenAI |
| GET | `/api/jobs/:id` | Returns job status and schema |
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
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/jobs/$($job.job.id)/run"
Invoke-RestMethod -Uri "http://localhost:3000/api/jobs/$($job.job.id)/records"
```

For known pages, set `source_strategy.type` to `provided_urls` and supply `sources` as an array of public HTTP(S) URLs.

A records response has `job_id`, `status`, `count`, and `records`. Each record includes `id`, `source_url`, `data`, and `extracted_at`. `data` contains every planned field, using `null` when the extracted value is unavailable. WebForge adds `source_url` from the actual page URL. Records remain available if a later refresh fails; the job status and error report the failure.

## How it works

1. The dashboard sends the plain-English request to `POST /api/jobs`.
2. OpenAI Responses plans the schema and focused search queries.
3. Firecrawl Search discovers up to five pages for automatic jobs. Provided URL jobs skip search.
4. Firecrawl Scrape's JSON format extracts a record using the planned field schema.
5. WebForge checks the returned JSON shape, fills missing fields with `null`, and saves successful records in SQLite.
6. `GET /api/jobs/:id/records` serves the stored JSON.

`planned` means a schema exists but the data run has not finished. `ready` means at least one record was saved. Other statuses show discovery, scraping, extraction, storage, or failure. A partial failure can leave the job `ready` with an error describing failed pages.

## Current scope

- One source page produces one record. Broad list pages may not yield every item on the page.
- The five page cap bounds demo time and Firecrawl usage. Search can return irrelevant pages; this MVP trusts Firecrawl extraction and does not fact check values.
- Refresh is manual. `refresh_interval` is stored for later scheduling but does not trigger automatic runs.
- Fields visible only in product images, OCR, login-only pages, and private pages are outside this version.
- The extraction provider is behind `ExtractionProvider` in `src/lib/providers/firecrawl.ts`, so a later local Qwen provider can return the same record shape.
- This is a local hackathon MVP with no API authentication or hosted background worker. Add those before exposing it publicly.

## Verify

```powershell
npm test
npm run lint
npm run build
```