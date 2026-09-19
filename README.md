# WebForge

WebForge turns a natural-language data request into a persistent, validated API job. The API job is the central object that discovery, scraping, extraction, storage, serving, and refresh stages will operate on.

The current implementation performs live API planning and persistence. It intentionally does not scrape pages, extract records, generate sample data, or analyze images yet.

## Run locally

Requirements:

- Node.js 24 or newer
- An OpenAI API key

```powershell
npm install
Copy-Item .env.example .env.local
```

Add `OPENAI_API_KEY` to `.env.local`, then run:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Every submitted request is planned live; there is no demo mode or hard-coded schema path.

## API job model

An API job contains:

```json
{
  "id": "uuid",
  "name": "Public company cybersecurity incidents",
  "user_request": "Track major cybersecurity incidents affecting public companies.",
  "status": "ready",
  "schema": {
    "title": {
      "type": "string",
      "description": "Name of the cybersecurity incident"
    },
    "company": {
      "type": "string",
      "description": "Affected public company"
    },
    "source_url": {
      "type": "string",
      "description": "Public URL used as the primary source for this record"
    }
  },
  "source_strategy": {
    "type": "automatic",
    "search_queries": ["major public company cybersecurity incidents"]
  },
  "sources": [],
  "refresh_interval": null,
  "error": null,
  "created_at": "2026-09-19T12:00:00.000Z",
  "updated_at": "2026-09-19T12:00:01.000Z"
}
```

`refresh_interval` is expressed in minutes. `null` means manual refresh.

Supported lifecycle statuses are:

- `planning`
- `discovering`
- `scraping`
- `extracting`
- `storing`
- `ready`
- `failed`

At this stage, `ready` means the job definition and schema are ready for the next pipeline stage. Discovery and scraping are not started.

## API

```http
GET  /api/config
GET  /api/jobs
POST /api/jobs
GET  /api/jobs/:id
GET  /api/jobs/:id/schema
```

Create a job with automatic source discovery configured for a later stage:

```powershell
$body = @{
  user_request = "Track major cybersecurity incidents affecting public companies."
  source_strategy = @{
    type = "automatic"
    search_queries = @()
  }
  sources = @()
  refresh_interval = 1440
} | ConvertTo-Json -Depth 4

Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/jobs -ContentType application/json -Body $body
```

Use known public sources instead:

```json
{
  "user_request": "Track major cybersecurity incidents affecting public companies.",
  "source_strategy": {
    "type": "provided_urls",
    "search_queries": []
  },
  "sources": [
    "https://example.com/public-incident-report"
  ],
  "refresh_interval": null
}
```

## Architecture

| Layer | Implementation |
| --- | --- |
| Interface and HTTP API | Next.js 16, React 19, TypeScript |
| Live request planning | OpenAI Responses API with strict JSON Schema output |
| Runtime validation | Zod |
| Local persistence | SQLite through Node's `node:sqlite` |
| Future source discovery and scraping | Firecrawl, deliberately not connected yet |

The local database defaults to `.data/webforge.sqlite`. The older dataset tables, if present in an existing local database, are ignored; all new work uses the `api_jobs` table.

## Verification

```powershell
npm test
npm run lint
npm run build
```
